# Privacy

YouTube Study Panel does not upload video information, subtitles, or learning activity to any external service, with one exception described below.

The extension stores only local preferences and learning state such as panel visibility, preferred subtitle language, playback speed, whether speed should be remembered, per-video A-B loop points and loop status, and saved words/sentences (the vocabulary notebook). Subtitle files and vocabulary exports are generated locally in the browser when the user requests a download.

## Dictionary lookups

When you hover over or click a word in the transcript panel or in the on-video subtitle overlay, the extension sends that single word (and, if needed, a simple variant of it such as its base form) to the free dictionary API at `https://api.dictionaryapi.dev` to fetch its definition. Nothing else (video URL, subtitles, or your saved vocabulary) is sent. If you prefer not to make these requests, turn off the "视频字幕" overlay and avoid hovering over or clicking words in the transcript; all other features work fully offline.

## Local dictionary mode (optional, fully offline)

The extension can optionally install a local English–Chinese dictionary (about 2.2MB, built from the open-source [ECDICT](https://github.com/skywind3000/ECDICT) project, MIT licensed). When local dictionary mode is active, word lookups are answered entirely from data stored in your browser—no network requests are made for any word the dictionary contains. Words missing from the local dictionary fall back to the online dictionary described above. You can delete the local dictionary at any time in the extension's settings.

## AI dictionary mode (optional, user-configured)

If you enable AI lookups in the extension's settings and provide your own API key, word lookups are sent to the AI provider you choose (e.g. Zhipu, DeepSeek, Moonshot, OpenAI, Alibaba DashScope, or a custom OpenAI-compatible endpoint). Hovering sends only the single word; clicking sends the word plus the subtitle sentence it appears in, so the model can explain it in context. The API key and provider configuration are stored only in your browser's local extension storage and are never sent anywhere except to your chosen provider's endpoint. Lookup results are cached locally to avoid repeat requests. You can disable AI mode at any time in the settings.
