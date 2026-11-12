<p align="center">
  <img src="app/assets/brand/logo.png" width="112" alt="Tugou Logo">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<h1 align="center">Tugou · 土狗</h1>

**AI image generation, image tools, layer editing, presentations, and font creation in one local project.**

Tugou is a creative workspace for everyone. Use each module independently, in any order. Work manually or connect an MCP-compatible AI client to use its canvas, image generation, image tools, and presentation features. Projects and assets stay on your computer; cloud generation and analysis use the model providers you configure.

**v0.8.18 release in preparation** · [Download](https://github.com/Even1997/tugou/releases/latest) · [Release notes](docs/releases/v0.8.18.md) · [Changelog](CHANGELOG.md) · [Developer guide](app/README.md)

This page is available in English; the guides linked below are in Chinese. Some application labels remain in Chinese, so the instructions include the original menu names where useful.

## What you can do

| Module | Main features |
| --- | --- |
| Home | See project and task summaries, resume recent work, and find MCP connection instructions |
| Prompts | Manage reusable modules and recipes, preview module text or combined recipe content on hover, and organize references, requirements, and visual analysis results |
| Canvas | Connect text, references, generation workbenches, and image tools; results appear as separate image nodes to the right, ready for further processing or branches; select multiple images for side-by-side comparison |
| Layers | Multiple artboards, a vertical tool rail and persistent layer list; inline text editing, selection formatting, lines, groups, masks, adjustments, effects, and basic PSD import/export |
| PPT | A top formatting ribbon, inline text editing and selection formatting; multiple decks, outlines, speaker notes, lines, shapes, presentation mode, and editable `.pptx` export |
| Tools | Remove backgrounds, upscale, resize, crop, rotate, extend, and adjust images; combine images into GIFs, and connect supported image tools as canvas workbenches |
| Assets | Import, search, preview, and reuse images and GIFs; inspect sources and generation details, and manage unused assets |
| Fonts | Create font projects, import glyph sheets, recognize and review character mappings, adjust outlines, export TTF / WOFF2, and use the fonts in Tugou |
| Settings | Configure appearance, canvas interaction, notifications, storage, model connections, MCP, shortcuts, and updates separately |

Open whichever module you need: compose manually, process images, make presentations, or connect AI. Modules reuse project assets, and Layers and PPT share the font library. The canvas supports image comparison, prompts support full-content previews, and in-app Help provides searchable instructions.

## Download and install

Download an installer to get started. You do not need to clone the repository or run the Web or Go services.

| Platform | Installer |
| --- | --- |
| Windows x64 | [Download EXE](https://github.com/Even1997/tugou/releases/download/v0.8.18/tugou-0.8.18-win-x64.exe) |
| macOS 13+ · Apple Silicon (M series) | [Download arm64 DMG](https://github.com/Even1997/tugou/releases/download/v0.8.18/tugou-0.8.18-mac-arm64.dmg) |
| macOS 13+ · Intel | [Download x64 DMG](https://github.com/Even1997/tugou/releases/download/v0.8.18/tugou-0.8.18-mac-x64.dmg) |

Mac ZIP packages are also available among the [release assets and SHA256 checksums](https://github.com/Even1997/tugou/releases/tag/v0.8.18). There is currently no official Linux installer.

- **Windows:** Run the EXE and follow the installer. The package has no commercial code signature, so Windows may show an unknown-publisher warning. Verify the download source and checksum.
- **Mac:** Open the DMG for your processor and drag `Tugou.app` into Applications. The app currently uses ad-hoc signing and is not notarized by Apple. If macOS blocks the first launch, verify the source and follow the system's Privacy & Security instructions.
- **Updates:** Save your project first. With automatic checks enabled, Tugou checks at startup and every 30 minutes while running. You can also check manually in Settings → Updates (设置 → 更新). A new version triggers a dialog and keeps an update entry available. “Skip this version” silences only that version; newer versions can still notify you. Installation requires confirmation. On Mac, save and quit before replacing the app manually. Reconnect your MCP client after upgrading.

## First steps

Basic image editing, layer composition, and PPT editing do not require cloud models. Configure your own provider when you need AI image generation, visual analysis, or text assistance:

1. Create a project and open Settings → Model connections → Manage providers and models (设置 → 模型连接 → 管理供应商与模型).
2. Add a provider with its API endpoint and API key. A provider can store multiple named keys; create separate providers for different endpoints.
3. Test the connection, fetch or manually enter model IDs, and set defaults for image generation, visual analysis, and text assistance.
4. On the Canvas (画布), add prompts, reference images, and a generation workbench. Connect the inputs and generate. Results appear to the right; the task panel shows progress and lets you cancel or retry manually.
5. Connect results to tools such as upscaling or background removal, or use them in Layers (图层) and PPT. Save your project and export your work.

Image nodes support brushes, rectangles, and ellipses for marking a local edit region before sending it to a generation workbench. Image editing support, models, dimensions, and quality depend on the provider. Tugou does not include free model credits; canceling a local task does not guarantee that the provider stops billing.

## Making presentations

Create, edit, and present manually, or use an AI client connected through MCP:

1. **Write the outline first.** Organize titles and content by slide, edit each slide in a single text field, and ask the user to confirm.
2. **Choose the next step.** After outline approval, let the user choose visual design or speaker notes first. The AI should not perform both automatically.
3. **Follow the selected branch.** For design, confirm the scope of visual proposals, show concept boards, and wait for a selection before building the deck. Speaker notes are saved separately without changing slide visuals or generating images. Preserve existing notes during design.
4. **Review the rendered slides and deliver.** Inspect actual screenshots slide by slide, fix issues, capture them again, then save or export `.pptx`. Speaker notes are exported as notes and do not appear on the presentation canvas.

These are workflow instructions for external AI clients. Tugou does not contain an Agent that automatically completes the entire process. See the [PPT design standard](docs/engineering/ppt-design-standard.md).

## MCP: let AI use Tugou

1. Start Tugou and enable the service in Settings → MCP & AI (设置 → MCP 与 AI 调用).
2. Copy the generated generic JSON, VS Code JSON, or Codex TOML into your client's MCP configuration.
3. Keep Tugou running. The AI should call `get_state` for live state, then `list_commands` to discover commands. Create or open a project before editing it.

The connection uses **local stdio**, not a remote HTTP URL. Any AI client supporting standard stdio can connect according to its own configuration format; it is not limited to Codex. Configuration includes local paths, so use the configuration generated on your own device. Copied configurations do not include provider API keys.

MCP covers projects, prompts, canvas nodes, image tools, layers and masks, PPT outlines and notes, fonts, models, and tasks. Edits share the same project as the UI, with live revision checks, batch undo, and generation request deduplication. `ppt.preview` returns an actual PNG image; `ui.capture` captures the visible application UI. The client must support MCP images, and the Tugou window must be visible during capture.

For example, ask your connected AI client:

> Use Tugou to create a project report presentation. Show me the outline for approval first, then let me choose visual design or speaker notes. Use Tugou image generation when illustrations are needed, and inspect screenshots of every slide after designing it.

MCP supplies tools and rules; the AI client handles planning, questions, and execution. This does not mean every UI feature can be automated. See [PPT and MCP](docs/engineering/presentations.md) and [UI capture and navigation](docs/engineering/ui-mcp.md).

## Data, connectivity, and limitations

**Local data.** Projects, assets, font projects, and tasks are stored locally. Installed builds use the following default workspace locations; Settings → Files & storage (设置 → 文件与存储) shows the actual directory. Development previews use a separate data directory.

```text
Windows  %APPDATA%\TugouIndependent\workspace
macOS    ~/Library/Application Support/TugouIndependent/workspace
```

Before backing up, save and quit Tugou, then copy the entire user data directory, not just the project JSON. The desktop main process stores API keys through the operating system's encryption interface. When calling cloud models, prompts and reference images are sent to the configured provider.

**Local tools.** Local AI components and fonts download on demand. Initial downloads require internet access; the corresponding features can run offline after downloading and installing them. Cloud generation and analysis still require internet access. See the [font catalog](app/assets/fonts/CATALOG.md) for available fonts and licenses.

Keep these limitations in mind:

- **GIF:** Create animations from multiple images, or import GIFs into the canvas, asset library, and Layers. Layers supports playback, frame selection with a slider, and export as GIF or a selected-frame PNG.
- **PPT:** Creation, editing, presentation, and export are supported. `.pptx` import is not yet supported, fonts are not embedded, and GIFs use their first frame. Tugou screenshots do not replace checking the exported layout in Office / WPS.
- **PSD:** Basic import/export includes a conversion report on import. Complex Photoshop effects and text are not guaranteed to remain fully editable or visually identical.
- **Font creation:** OCR, tracing, and font compilation require additional local setup; see the [font environment guide](app/README.md#字体环境). Exports contain only glyphs that were imported and reviewed. A few designed characters do not automatically produce a complete Chinese font.

## Run from source

The current desktop app lives in `app/` and uses Node.js 22 LTS or a compatible newer version. Historical Web / Go code and documentation remain in this repository but are not startup dependencies for the desktop app.

```sh
git clone https://github.com/Even1997/tugou.git
cd tugou/app
npm ci
npm run dev
```

Development previews support UI hot reload. Changes to the main process, preload, or runtime dependencies still require saving and restarting. For builds, tests, font setup, and releases, see the [desktop developer guide](app/README.md).

## Documentation, license, and feedback

- [Release notes](docs/releases/v0.8.18.md) · [Changelog](CHANGELOG.md) · [Release verification](docs/engineering/release-v0.8.18.md)
- [PPT design and MCP workflow](docs/engineering/ppt-design-standard.md) · [Font catalog](app/assets/fonts/CATALOG.md)
- [Developer guide](app/README.md) · [Documentation index](docs/index.md) · [Pending verification](docs/progress/pending-test.md) · [Roadmap](docs/progress/todo.md)

The project's own code is licensed under [Apache-2.0](LICENSE), Copyright © 2026 Even. Third-party code, fonts, models, and runtimes retain their respective licenses; see [NOTICE](NOTICE), [licensing scope](app/LICENSING.md), and [third-party notices](THIRD-PARTY-NOTICES.md). The current LICENSE does not retroactively change licenses for historical versions.

Report issues on [GitHub Issues](https://github.com/Even1997/tugou/issues) with the version, operating system, reproduction steps, and redacted screenshots. Do not upload API keys or private assets you are not authorized to share.
