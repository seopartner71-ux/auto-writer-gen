import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, site_id, ...params } = body;

    // Get WP site credentials
    const { data: site, error: siteErr } = await admin
      .from("wordpress_sites")
      .select("*")
      .eq("id", site_id)
      .eq("user_id", userId)
      .single();
    if (siteErr || !site) throw new Error("WordPress site not found");

    // Decrypt app_password
    const { data: decryptedPw, error: decErr } = await admin.rpc("decrypt_sensitive", { ciphertext: site.app_password });
    const plainPassword = decErr ? site.app_password : (decryptedPw ?? site.app_password);
    const wpAuth = btoa(`${site.username}:${plainPassword}`);
    const baseUrl = site.site_url.replace(/\/+$/, "");

    const wpFetch = async (endpoint: string, options: RequestInit = {}) => {
      const url = `${baseUrl}/wp-json${endpoint}`;
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Basic ${wpAuth}`,
          ...options.headers,
        },
      });
      if (!res.ok) {
        const errText = await res.text();
        let errMsg = `WordPress error ${res.status}`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.message || errMsg;
        } catch { /* use default */ }
        throw new Error(errMsg);
      }
      return res.json();
    };

    let result: any;

    switch (action) {
      case "test_connection": {
        const userInfo = await wpFetch("/wp/v2/users/me?context=edit");
        // Update site as connected
        await admin
          .from("wordpress_sites")
          .update({ is_connected: true, site_name: userInfo.name || site.site_url })
          .eq("id", site_id);
        result = { connected: true, user: userInfo.name, url: site.site_url };
        break;
      }

      case "fetch_categories": {
        const cats = await wpFetch("/wp/v2/categories?per_page=100");
        result = { categories: cats.map((c: any) => ({ id: c.id, name: c.name, slug: c.slug, count: c.count })) };
        break;
      }

      case "fetch_tags": {
        const tags = await wpFetch("/wp/v2/tags?per_page=100");
        result = { tags: tags.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug })) };
        break;
      }

      case "upload_media": {
        const { image_base64, filename } = params;
        if (!image_base64) throw new Error("No image data provided");

        // Decode base64
        const binaryStr = atob(image_base64.replace(/^data:image\/\w+;base64,/, ""));
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const mediaRes = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${wpAuth}`,
            "Content-Disposition": `attachment; filename="${filename || "featured-image.png"}"`,
            "Content-Type": "image/png",
          },
          body: bytes,
        });

        if (!mediaRes.ok) {
          const errText = await mediaRes.text();
          throw new Error(`Media upload failed: ${mediaRes.status} ${errText}`);
        }

        const media = await mediaRes.json();
        result = { media_id: media.id, source_url: media.source_url };
        break;
      }

      case "create_post": {
        const {
          title, content, excerpt, status = "draft",
          categories = [], tags = [], featured_media,
          meta_title, meta_description, seo_plugin,
        } = params;

        const postData: any = {
          title,
          content,
          excerpt: excerpt || "",
          status,
          categories,
          tags,
        };

        if (featured_media) {
          postData.featured_media = featured_media;
        }

        // SEO plugin meta
        if (seo_plugin === "rank_math" && (meta_title || meta_description)) {
          postData.meta = {};
          if (meta_title) postData.meta.rank_math_title = meta_title;
          if (meta_description) postData.meta.rank_math_description = meta_description;
        } else if (seo_plugin === "yoast" && (meta_title || meta_description)) {
          postData.meta = {};
          if (meta_title) postData.meta._yoast_wpseo_title = meta_title;
          if (meta_description) postData.meta._yoast_wpseo_metadesc = meta_description;
        }

        const post = await wpFetch("/wp/v2/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postData),
        });

        result = {
          post_id: post.id,
          post_url: post.link,
          edit_url: `${baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
          status: post.status,
        };

        // Log publish action
        await admin.from("usage_logs").insert({
          user_id: userId,
          action: "publish_wordpress",
        });
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("wordpress-proxy error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
