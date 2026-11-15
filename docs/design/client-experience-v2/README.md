# Client Experience v2 — design reference

The approved mockup for the redesign (spec: `docs/superpowers/specs/2026-11-15-client-experience-v2-design.md`).

- `mockup.html` — open in a browser. Top bar switches screens (Intake, Portal, Approval, Admin, Emails) and Desktop/Phone.
- `src/index.css` — the design tokens and component classes. `src/app/ui.css` in the app is built from this file.
- `src/screens/*.tsx.ref` — reference markup for each screen (React + plain CSS classes). Copy structure and class names; wire to real data.
- `src/art.tsx.ref`, `src/data.ts.ref` — fictional sample artwork and data. **Never ship these.**

This folder is documentation only. It is not imported by the app and not built.

Files end in `.ref` so the app's TypeScript build ignores them. Read them as TSX.
