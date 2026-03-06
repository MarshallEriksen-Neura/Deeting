# Deeting

Main repository for the Deeting project.

## Submodules

This repo currently includes these Git submodules:

- deeting-relay - relay service repository
- scout - scout repository

Clone with submodules:

`ash
git clone --recurse-submodules https://github.com/MarshallEriksen-Neura/Deeting.git
`

If you already cloned the repo:

`ash
git submodule update --init --recursive
`

When updating a submodule:

1. Enter the submodule directory and commit/push changes there first.
2. Return to the parent repo.
3. Run git add <submodule-path> and commit the updated submodule pointer.