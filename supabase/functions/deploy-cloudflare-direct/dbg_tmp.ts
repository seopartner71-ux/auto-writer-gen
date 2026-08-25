import { renderTemplate } from "./templates.ts";
import { applyCommerceLayer } from "./commercePages.ts";
const ctx = (e={}) => ({siteName:"Море болтов",siteAbout:"Крепеж",topic:"крепеж",accent:"#6E56CF",headingFont:"Inter",bodyFont:"Inter",template:"minimal",domain:"example.com",projectId:"proj-3d",
 posts:Array.from({length:10},(_,i)=>({title:`Статья ${i+1}`,slug:`post-${i+1}`,excerpt:"x",contentHtml:"<p>y</p>",publishedAt:"2026-01-01T10:00:00.000Z"})),...e});
const a = renderTemplate(ctx() as never), b = renderTemplate(ctx() as never);
const diff = Object.keys(a).filter(k=>a[k]!==b[k]);
console.log("nondeterministic keys:", diff.slice(0,5), diff.length);
const c = renderTemplate(ctx({shouldRenderPage:(p:string)=>!p.startsWith("posts/")||p==="posts/post-3.html"}) as never);
console.log("post pages:", Object.keys(c).filter(k=>k.startsWith("posts/")));
