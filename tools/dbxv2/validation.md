# Qualification du 21 octobre 2026

## Installation et moteur

- Base Boxedwine64 : `dee2ff3f08d9b5bdfe78c15bdefbf8f89b4f1639`.
- Build Emscripten 6.0.0 avec quatre travailleurs sur la fabrique VPS : code 0.
- Installation originale : 65 fichiers, 39 496 724 198 octets. Archive ZIP64
  virtuelle : 39 496 738 298 octets, sans copie intégrale des CPK.
- HTTP réel via tunnel local : `bytes=39000000000-39000000003` retourne 206,
  quatre octets et `Content-Range: bytes 39000000000-39000000003/39496738298`.
- Chrome exécute Wine 8 et `wine64 --version` termine avec le code 0.
- Le profil charge le montage complet puis demande à Wine de lancer le véritable
  `START.exe`. Aucun menu ni partie DBXV2 n'est confirmé.

## Sonde Direct3D indépendante, réellement exécutée dans Chrome

La sonde `probe-d3d11.c` est compilée en PE AMD64, puis montée seule dans une
archive de 266 372 octets. Le navigateur rapporte :

```text
gl64: host GL up (WebGL2)
D3D11_PROBE hardware hresult=0x00000000 feature_level=0x9100 device=1 context=1
CPU64: exit_group syscall, status=5 pid=10
```

La création d'un périphérique D3D11 réussit avec le niveau de fonctionnalités
**9.1**. La sonde retourne volontairement 5 car elle exige au moins 11.0. Cela
prouve une couverture partielle de l'API ; cela ne prouve ni le niveau 11.0,
ni le rendu du jeu. Ce test ne monte aucun fichier DBXV2.

## Défaut CPU reproduit

Le premier lancement original a rapporté :

```text
CPU64: unimpl opcode at RIP=0x140020940 bytes=c2 00 00 cc cc cc cc
```

L'instruction `RET imm16` est corrigée dans l'émulateur. Le moteur recompilé
(SHA-256 WASM `447842aa9a4a9124e733493cd1b9d02fcecfa538f2a929437951f409514c82ec`)
exécute ses tests directement dans Chrome via `--x64-selftest` : **238 réussis,
zéro échec**, dont les quatre nouveaux cas RET imm16. Le test multithread dans
Bun avait expiré sans assertions et n'est pas compté comme une validation.
Le jeu est relancé avec `?session=0` pour éviter les programmes auxiliaires de
la session persistante ; son résultat reste à qualifier séparément.

## Compression

Sur le premier moteur patché, le WASM de 2 638 098 octets donne 685 890 octets en
Brotli ; le JavaScript de 410 269 octets donne 83 613 octets. Les archives ZIP/CPK
conservent leur représentation originale pour les lectures Range. La négociation
HTTP des fichiers précompressés est testée localement, mais le serveur de test
déjà démarré n'a pas encore été relancé avec cette nouvelle version.

Ce rapport ne constitue pas une validation de production. Aucun déploiement du
jeu comme produit jouable n'a été effectué dans ce lot.
