# Design Debt Audit — JXEngine Web Panel

## 1. Stack Identification
- **Runtime**: Node.js v26 + TypeScript (ES2022 / NodeNext)
- **UI Surface**: Native HTML5 / CSS3 / Vanilla JavaScript embedded in `src/panel.html` (zero-bundle overhead for local engine)
- **Current Layout Constraints**: Fixed 820px container (`app-container`), basic monochrome dark theme, minimal visual hierarchy between navigation and controls.

## 2. Bidirectional Reach Matrix (Daemon-to-UI)
- [x] `GET /health` -> Topbar status pill
- [x] `GET /v1/models` -> Model selector dropdown
- [x] `GET /api/status` -> Live running state & start/stop toggling
- [x] `POST /api/load` -> Context and hardware parameter submission
- [x] `POST /api/unload` -> Process teardown
- [x] `GET /api/dirs` -> List model directories
- [x] `POST /api/dirs` -> Add / Remove model directories
- [ ] `GET /api/doctor` -> Hardware diagnostics (Currently missing direct visual dashboard card in panel!)

## 3. Aesthetic & Motion Deficiencies
1. **Skinny Container**: Constrained to `820px`, wasting 50%+ of wide screens on modern 1440p+ displays.
2. **Static Interactions**: Zero spring physics or fluid state transitions during model spin-up.
3. **Missing Hardware Visualizer**: System hardware specs (Metal memory bar, RAM allocation, CPU performance core count) are not visually charted.
4. **Endpoint Readouts**: Monospace text lacks one-click clipboard copy interactions and quick-test curl modals.
