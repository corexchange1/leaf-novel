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

## Story pack auto update

Build the public story pack before pushing:

```bash
npm run sync:stories
```

The build writes:

```text
public/updates/stories-index.json
public/updates/stories-pack.zip
```

Current production update index:

```text
https://raw.githubusercontent.com/corexchange1/leaf-novel/master/public/updates/stories-index.json
```

The app checks that index when opened and every 10 minutes while running. If
`dataVersion` is newer, it downloads `stories-pack.zip`, verifies SHA-256,
extracts the pack, and refreshes the story cache. If `latestApp.versionCode` is
newer than the installed app, the update screen reports that an app update is
available.

For builds with a fixed default URL:

```bash
VITE_STORY_UPDATE_URL="https://raw.githubusercontent.com/<owner>/<repo>/<branch>/public/updates/stories-index.json" npm run android:debug
```

## Demo images

The demo covers are local PNG crops made from Unsplash photos:

- `than-dao-chi-ton`: https://unsplash.com/photos/MjzyGq03xGY
- `gap-em-la-dinh-menh`: https://unsplash.com/photos/dNzg0HGJTbA
- `ngoi-lang-khong-ten`: https://unsplash.com/photos/xOydgt5_K9U
