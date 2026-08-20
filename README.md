# Ramify

An interactive proof tree widget for Lean 4 drawn in the VS Code Lean infoview. It reads the tactics under your cursor and lets you read and edit the source proof from the tree. Comes in two parts: the widget and a VS Code extension.

<img height="420" alt="screenshot of the widget with multiple cases and comments" src="https://github.com/user-attachments/assets/194dec0a-3c54-428f-b495-9d8d4d220eea" />


Quickstart: see [INSTALL.md](INSTALL.md#quickstart).

> [!Note]
> - Your project must be on Lean `v4.32.2` (with Mathlib `v4.32.2` if you use Mathlib).
> - The first build takes a few minutes, almost all of it ProofWidgets compiling its own widget JS.
> - `ProofTreeTour.lean` purposefully does not compile, since it shows errors/proofs in progress

This project is MIT licensed: see [LICENSE](LICENSE). For third-party attribution see [NOTICE](NOTICE).
