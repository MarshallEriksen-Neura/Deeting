"use client";

import { AuthSync } from "./auth-sync";
import { DesktopAuthBootstrap } from "./desktop-auth-bootstrap";
import { DesktopOAuthListener } from "./desktop-oauth-listener";

export function AuthWorldBridge() {
  return (
    <>
      <AuthSync />
      <DesktopAuthBootstrap />
      <DesktopOAuthListener />
    </>
  );
}
