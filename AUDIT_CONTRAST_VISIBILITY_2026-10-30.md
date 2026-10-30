# Contrast visibility audit — scope and operating rules

This scanner is a read-only heuristic. It must not automatically rewrite CSS from a heuristic hit alone.

## Scope
- Scan HTML and CSS in the existing 11 repositories.
- Flag explicit low opacity and rules where text and surface colors are both explicitly pale.
- Upload a per-repository JSON artifact.
- Treat hits as candidates. CSS variables, cascade order, pseudo-states, dynamic DOM, images, and user-agent styles mean the scanner cannot certify WCAG contrast.

## Automatic repair gate
1. Confirm a finding in rendered browser-computed styles or a reproducible screenshot.
2. Make the smallest style-only change; do not edit question/answer data.
3. Run syntax, static, responsive, and browser checks.
4. Publish only when all required checks pass; if any check fails, stop and keep the change out of main.
5. Verify the deployed page and a real phone/desktop view before marking the visual issue resolved.

## Current known issue
The user-provided screenshot showed very pale text on white option rows over a dark navy page. A scoped high-contrast style correction was merged in `highschool-social-studies` and its static/UI/deploy workflows passed. Real-device confirmation and a complete check of all other repositories are still required.
