# LeafNovel

Mobile-first local AI novel reader.

## Run local

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:5174

By default the backend scans `./stories`. To use another folder:

```bash
STORIES_DIR="/absolute/path/to/stories" npm run dev:api
```

## Story format

```text
stories/
  story-id/
    meta.json
    cover.png
    chapters/
      001.md
      001.png
      002.md
```

Chapter titles can come from frontmatter `title` or the first markdown heading.
Chapter images are optional. Put `001.png`, `001.jpg`, `001.jpeg`, or `001.webp`
next to `001.md`/`001.html`; the app shows the image at the top of that chapter.

## GitHub story auto update

Build the public story manifest before pushing:

```bash
npm run sync:stories
```

After the repo is on GitHub, use this raw URL in the app Settings field
`GitHub manifest`:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/public/bundled-stories/manifest.json
```

Current production manifest:

```text
https://raw.githubusercontent.com/corexchange1/leaf-novel/master/public/bundled-stories/manifest.json
```

The app checks that manifest when opened and every 10 minutes while running.
Future story/chapter/image updates only need a GitHub push; installed apps will
pull the new manifest automatically when `Auto update từ GitHub` is enabled.

For builds with a fixed default URL:

```bash
VITE_STORY_UPDATE_URL="https://raw.githubusercontent.com/<owner>/<repo>/<branch>/public/bundled-stories/manifest.json" npm run android:debug
```

## Demo images

The demo covers are local PNG crops made from Unsplash photos:

- `than-dao-chi-ton`: https://unsplash.com/photos/MjzyGq03xGY
- `gap-em-la-dinh-menh`: https://unsplash.com/photos/dNzg0HGJTbA
- `ngoi-lang-khong-ten`: https://unsplash.com/photos/xOydgt5_K9U
