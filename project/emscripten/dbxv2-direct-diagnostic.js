// SPDX-License-Identifier: GPL-2.0-or-later
import { loadDbxv2Profile } from "./dbxv2-profile.js";

const button = document.getElementById("launch");
const status = document.getElementById("status");
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    if (!crossOriginIsolated)
      throw new Error("COOP/COEP requis pour le moteur.");
    const profile = await loadDbxv2Profile();
    profile.program = "/home/username/DBXV2/bin/DBXV2.exe";
    profile.programArgv = [profile.program];
    profile.workingDirectory = "/home/username/DBXV2/bin";
    profile.observeRuntime = (runtime) => {
      runtime.ENV = runtime.ENV || {};
      runtime.ENV.BW64_DLLTRACE = "1";
      runtime.ENV.BW64_SCDUMP = "1";
      runtime.ENV.BW64_TRACE_EXE = "DBXV2.exe";
    };
    const url = new URL(location.href);
    url.searchParams.set("session", "0");
    url.searchParams.set("winedbg", "-all,+module,+loaddll,+process,+seh");
    history.replaceState(null, "", url);
    window.BW64_BOOT_PROFILE = profile;
    console.log("DBXV2_DIRECT_DIAGNOSTIC", {
      program: profile.program,
      workingDirectory: profile.workingDirectory,
      archiveCount: profile.zipSpecs.length,
      originalProgramUnmodified: true,
    });
    status.textContent =
      "Diagnostic du programme original depuis son dossier bin…";
    const script = document.createElement("script");
    script.src = "wine64-launcher.js";
    script.onerror = () => {
      status.textContent = "Chargement du moteur échoué.";
    };
    document.body.append(script);
  } catch (error) {
    status.textContent = String(error);
    button.disabled = false;
  }
});
