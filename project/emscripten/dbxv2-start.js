// SPDX-License-Identifier: GPL-2.0-or-later
import { loadDbxv2Profile } from "./dbxv2-profile.js";
import { observeSdlAudio } from "./dbxv2-audio.js";
const button = document.getElementById("launch");
const status = document.getElementById("status");
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    if (!crossOriginIsolated)
      throw new Error(
        "Le serveur doit fournir les en-têtes COOP et COEP pour SharedArrayBuffer.",
      );
    status.textContent =
      "Vérification du montage et des lectures HTTP partielles…";
    window.BW64_BOOT_PROFILE = await loadDbxv2Profile();
    window.BW64_BOOT_PROFILE.observeRuntime = (runtime) => {
      const output = document.getElementById("audio-status");
      const observer = observeSdlAudio(
        () => runtime,
        (metrics) => {
          if (output) output.textContent = JSON.stringify(metrics);
        },
      );
      document
        .getElementById("audio-resume")
        ?.addEventListener("click", () => observer.resume());
      window.addEventListener("pagehide", () => observer.stop(), {
        once: true,
      });
    };
    status.textContent = `${window.BW64_BOOT_PROFILE.entryCount} fichiers montés ; démarrage du moteur…`;
    const script = document.createElement("script");
    script.src = "wine64-launcher.js";
    script.onerror = () => {
      status.textContent =
        "Le lanceur Boxedwine64 n’a pas pu être chargé. Rechargez la page pour réessayer.";
    };
    document.body.append(script);
  } catch (error) {
    status.textContent = String(error);
    button.disabled = false;
  }
});
