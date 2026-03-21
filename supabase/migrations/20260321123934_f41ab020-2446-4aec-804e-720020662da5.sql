
-- Add niche and AI-analyzed style JSON to author_profiles
ALTER TABLE public.author_profiles ADD COLUMN niche text;
ALTER TABLE public.author_profiles ADD COLUMN style_analysis jsonb;
-- style_analysis stores: { paragraph_length, metaphor_usage, stop_words, emoji_frequency, sentence_complexity, tone_description }
