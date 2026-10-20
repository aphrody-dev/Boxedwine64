# Capacités Bun réutilisables pour DBXV2

Audit du 21 octobre 2026, en lecture seule. Sources : `C:/src/bun-os`, HEAD `1a9a1f027b4bb2af073f10f39a006a5d155cc071`. Runtime observé : `C:/bun/build/release/bun.exe`, `1.4.6-canary.1+169d8c5ea`. Aucun serveur, jeu, téléchargement ou build lancé pendant cet audit. Les aides exécutées prouvent les commandes ; la lecture des sources prouve les chemins implémentés, pas leur qualification complète sur le jeu.

## RE : triage et formats réellement disponibles

`re.cmd` délègue à `packages/re/scripts/rea.mjs`, puis au propriétaire `vendor/rea/scripts/rea.mjs`. Son aide générale annonce REA 6.5.0, mais le dispatcher possède aussi `bin`, `game`, `dbxv2`, `engine`, `formats`, `pipeline` et `recompile` (lignes 12–28). Ne pas confondre avec un autre exécutable REA installé.

Commandes pertinentes :

```powershell
re bin "C:/src/shenron/data/DB Xenoverse 2/bin/DBXV2.exe" --strings 0 --json
re game "C:/src/shenron/data/DB Xenoverse 2" detect --max-files 5
re game "C:/src/shenron/data/DB Xenoverse 2" index --db <index.sqlite>
re game "C:/src/shenron/data/DB Xenoverse 2" serve --db <index.sqlite> --host 127.0.0.1 --port 8793
```

Le parent a exécuté le premier avec succès : PE64 x86_64, 23 877 704 octets, 26 DLL, 1 414 imports, 2 exports ; SHA256 `8283d8e24e52047d9a71fcf4f08671de6167fa0576f3802f7831e2919eeb8e5f`. L'audit a exécuté directement le binaire natif `target/release/bunre.exe game detect ... --max-files 5` : 4 ms, START.exe et DBXV2.exe trouvés, EasyAntiCheat signalé, profil `generic`, `truncated=true`. Ce petit échantillon ne prouve pas l'inventaire complet des CPK.

`re bin` utilise `bunre pipeline triage` puis `bun:windows.pe` sans lifting (`vendor/rea/src/binary/inspect.ts:38`). À l'inverse, `re inspect` route vers `runDirectAnalysis(binary_overview)` (`src/cli/coreBinaryCommands.ts:134`) : l'ouverture d'analyse peut être coûteuse. `--filter-output` filtre la sortie, pas le travail. L'analyse lourde a été arrêtée par le parent ; aucune seconde analyse lourde n'a été lancée.

Un second triage réel sur `bin/xgcore.dll` confirme PE64 x86_64, 4 017 152
octets, 23 DLL, 258 imports et 3 600 exports ; SHA256
`5f8eed201c146b47aabee69aefc618ab4b815bb4b8eb6c726a3b736e055ed1b7`.
Il conserve un périmètre statique et ne prouve pas le rendu.

## « Model serve » : modèles 3D et modèles ML sont distincts

**Pour DBXV2, `re game ... serve` est un serveur de modèles 3D et d'assets.** Le code `vendor/rea/src/game/server.ts` expose `/model/<path>.glb`, `/tex/<path>.png`, `/audio/<path>.wav`, `/table/<path>.json`, `/vfs/*`. Un worker Rust persistant lit et convertit les assets ; ce n'est pas une façade de réponses vides. Le service lie localhost par défaut. Les octets originaux exigent le jeton configuré ; les formats dérivés sont publics sur l'interface liée. Aucun jeton consulté pendant cet audit.

Le convertisseur DBXV2 existe dans `crates/re/src/game/assets/export.rs:268–292` : il parse EMD, cherche EMB et ESK, assemble puis produit GLB. Limites explicites : animation passée à `None`, erreurs des fichiers annexes absorbées par `.ok()`. Il faut qualifier textures, squelette et animations sur les fichiers réels avant d'affirmer « personnage complet ». L'existence du convertisseur ne prouve ni combat ni gameplay.

**`aphrody-nie-model-serve` est également 3D, mais spécialisé Inazuma Eleven Victory Road.** Son `crates/aphrody-nie-model-serve/src/main.rs:1–43` assemble corps, face, uniforme, keshin et armure avec G4MD/G4MG/G4TX, manifestes CRC et tables Inazuma. Il expose notamment `/model-full/<code>.glb`. Ce n'est pas directement le serveur DBXV2 EMD/ESK. Usage décrit par la source, non lancé :

```text
aphrody-nie-model-serve --game-dir <installation-IEVR> --glb-dir <models> --db <mirror.sqlite> --port 8790
```

**Pour les modèles ML**, les aides installées `aphrody model --help` et `aphrody ai model --help` exposent catalog, pull, info, verify, doctor, ps et gestion du magasin. Elles n'exposent pas `serve`. `bun model --help` échoue avec « Script not found » ; `aphrody model serve` est une sous-commande inconnue.

Le service ML installé à utiliser est **`aphrody ai gateway serve`**, dont l'aide confirme une API HTTP compatible OpenAI, `--addr 127.0.0.1:8786` et `--provider configured|mistralrs|shenron|auto|google-antigravity|gemini-cli|openai`. Cette aide seule ne prouve pas qu'un modèle ou fournisseur est actuellement chargé. Aucun chargement d'inférence n'a été lancé. Une gateway ML n'apporte pas de backend D3D11 au jeu.

## WASM : réutiliser les propriétaires Rust

L'aide installée confirme `bun wasm build`, `bun wasm opt`, les cibles web/bundler/nodejs/deno/no-modules, les options Cargo `--package`, `--features`, `--no-default-features`, `--locked`, ainsi que `--cargo` pour conserver le wrapper et `--artifact` pour empaqueter un WASM déjà compilé. Ce pipeline Cargo + wasm-bindgen + wasm-opt construit du Rust compatible WASM ; il ne convertit pas automatiquement un EXE Win64.

`crates/re/src/game/wasm.rs` implémente notamment CPK/CRILAYLA, MSG, CUS/BAC/BDM/PUP, EMB, conversion audio, modèles assemblés JSON et `wasm_model_glb` (ligne 270). La conversion USM est conditionnée par `dbxv2`. `crates/re/Cargo.toml` déclare `wasm`, `assets`, `dbxv2`, `decompile`, avec encore des dépendances non optionnelles dont bun-steam et iced-x86. Un build minimal doit être vérifié avant de promettre taille ou compatibilité wasm32. La présence des exports en source n'atteste pas leur présence dans le WASM actuellement publié.

## Bun Engine et recompilation

Binaire trouvé : `C:/src/bun-os/target/debug/bun-engine.exe`. Son aide inclut `x86` et `linux`. L'implémentation `crates/bun-engine-core/src/machine/x86.rs` utilise Windows Hypervisor Platform, RAM plate et un vCPU ; ses entrées sont une image plate ou un Linux ELF. Ce chemin natif Windows ne constitue pas un chargeur Win64 dans Chrome.

`re recompile <image> --target wasm` existe, mais son contrat `vendor/rea/src/pipeline/recompile.ts:13–21` couvre GBA ARM/Thumb, PlayStation MIPS et NES 6502. Win64 n'est pas une machine acceptée. Les expériences web de Bun Engine concernent des cœurs console ; leurs aides ne prouvent pas DBXV2 exécutable.

## Steam

L'aide de `packages/bun-steam/src/cli.ts` a été exécutée. Capacités pertinentes : `client users`, `steamcmd status`, `proton list`, `proton runtimes`, `launch env`, `launch options` et `launch run`. `launch env` prépare notamment llvmpipe, threads et runtimes ; `launch run` demande le lancement au client Steam. Aucun lancement effectué ici, aucun fichier d'authentification lu. Ces capacités gèrent l'installation et l'environnement natif ; elles ne remplacent pas la traduction graphique Chrome.

## Conclusion d'intégration

Réutiliser `re game` et les fonctions Rust/WASM existantes pour le VFS et les assets DBXV2 ; qualifier les sorties plutôt que recopier les parseurs. Employer `re bin` pour le triage ciblé. Conserver Boxedwine pour l'exécution Win64 navigateur tant qu'une autre chaîne complète n'est pas qualifiée. La sonde Chrome rapportée par le parent crée réellement un device D3D11, HRESULT 0, mais seulement FL9.1 (`0x9100`) et sort avec code 5 au seuil FL11 ; aucune jouabilité DBXV2 n'est prouvée.
