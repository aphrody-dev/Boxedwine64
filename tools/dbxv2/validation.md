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

Le lancement suivant dépasse `RET imm16` puis rencontre `0f 2b 07` et
`0f 2b 47 10` à `0x140090270` : `MOVNTPS`. Le correctif ajoute les stores
`MOVNTPS/MOVNTPD` et trois tests de mémoire, préfixe 66 et registres REX.
Le nouveau WASM compilé porte le SHA-256
`0b5333e3e8a29878a69c7780e5df68ea76b793aad7a77642df40eb28a8e6a60b`.
Chrome, après rechargement du moteur, confirme **241 tests réussis, zéro échec**.
Ce résultat valide les tests CPU, pas le lancement complet du jeu.

L'absence de `libgnutls.so.30`, chargée dynamiquement par Wine, est corrigée
dans le script de construction du rootfs. Un overlay Debian Bookworm de neuf
bibliothèques (2 869 713 octets, SHA-256
`e023d0fa8bd1941e71bc69585dc67e324d3c261506aa92695acc5446082185c6`)
est monté par le profil. La fermeture des dépendances ELF et les versions GLIBC
sont vérifiées ; le chargement réel pendant le lancement reste à qualifier.

Le nouvel essai Chrome monte cet overlay, ne reproduit plus les échecs
`RET imm16`/`MOVNTPS`, puis atteint les chargements des DLL Steam, xgcore,
iggy et render_pass. Il rencontre ensuite une instruction non implémentée :
`0f 5a c6` (`CVTPS2PD`) à `0x14003aa44`. Le canevas reste noir ; aucun menu
ni gameplay n'est confirmé. L'absence d'erreur GnuTLS dans ce journal ne vaut
pas une qualification de connexion TLS.

`CVTPS2PD` est ensuite implémenté avec quatre tests : instruction réelle,
alias source/destination, lecture m64 en fin de page, registres REX avec zéro
signé et infini. Chrome exécute le nouveau WASM SHA-256
`3536227c3bbd523e17079c3afbdea8760e4b9da24a23d458af82bfa77291a0d8` :
**245 tests réussis, zéro échec**, dont les quatre nouvelles variantes.
Le nouvel essai du jeu dans Chrome atteint ensuite le processus Wine pid 49,
commande `Z:\home\username\DBXV2\bin\dbxv2.exe`, puis `exit_group status=53`.
Aucune nouvelle instruction non implémentée n'apparaît dans ce journal. Un
second essai avec `WINEDEBUG=+module` reproduit cette sortie sans fournir de
trace Wine indiquant une dépendance précise. La cause n'est donc pas encore
établie. Une sonde Windows indépendante charge les DLL originales pour isoler
le défaut ; les fichiers du jeu restent inchangés.

## Compression

Sur le premier moteur patché, le WASM de 2 638 098 octets donne 685 890 octets en
Brotli ; le JavaScript de 410 269 octets donne 83 613 octets. Les archives ZIP/CPK
conservent leur représentation originale pour les lectures Range. La négociation
HTTP des fichiers précompressés est testée localement. Le serveur de test a été
relancé avec cette version et son manifeste expose également l'overlay GnuTLS.
Le contrôle HTTP réel confirme le WASM Brotli de 686 136 octets, COEP
`require-corp`, et les réponses 206 exactes du jeu à 39 milliards d'octets et
de l'overlay GnuTLS. Les preuves brutes restent dans les artefacts de build
`server-verification.json` et `dbxv2-build-receipt.json`.

Ce rapport ne constitue pas une validation de production. Aucun déploiement du
jeu comme produit jouable n'a été effectué dans ce lot.
