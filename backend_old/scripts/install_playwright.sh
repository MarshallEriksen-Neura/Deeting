#!/bin/bash
set -e

echo "Installing Playwright dependencies..."
# Ensure virtualenv is active or we are running with uv/pip
# This command assumes 'playwright' package is already installed via pip/uv

echo "Installing Playwright browsers (chromium only for now to save space)..."
playwright install chromium

echo "Installing Playwright system dependencies..."
playwright install-deps chromium

echo "Playwright installation complete."
