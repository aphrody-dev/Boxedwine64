# Profil DBXV2 expérimental

Ce profil monte l'installation originale complète dans Boxedwine64 et lance
`START.exe`. Il ne remplace pas le jeu par un lecteur de ressources et ne modifie
ni Steam, ni EAC, ni les exécutables.

Depuis la racine du dépôt, après compilation du moteur et préparation de ses
rootfs :

```powershell
bun tools/dbxv2/serve.ts --game-dir "D:/Games/DB Xenoverse 2" --artifacts project/emscripten/Build/Wasm64Mt
```

Le dossier doit contenir `START.exe`, `bin/DBXV2.exe`, les DLL et `cpk/*.cpk`.
Fournir uniquement le dossier du jeu, sans données de compte Steam. Le serveur
vérifie les CRC par tranches de 1 Mio avant d'afficher son URL. Cette première
lecture parcourt les fichiers complets sur disque, mais ne les charge pas tous en
mémoire et ne crée aucune copie ZIP de 32 Go. Garder l'installation inchangée
pendant l'exécution ; arrêter et relancer le serveur après toute mise à jour.

Ouvrir `http://127.0.0.1:4538/dbxv2.html` dans Chrome et cliquer sur le bouton de
lancement. Le serveur écoute uniquement sur la boucle locale et fournit COOP/COEP.
Le dossier des artefacts doit fournir `boxedwine64.js`, son WASM et ses workers,
`glibc-rootfs64.zip`, `wine64.zip` et `prefix64.zip`. Les erreurs réelles du moteur
apparaissent dans le journal de la page. Cliquer dans le canevas pour lui donner
le focus clavier.

## Contrat du montage

`/dbxv2/manifest.json` fournit `archiveUrl`, `archiveBytes`, `entryCount`, et
éventuellement `executable` (défaut `START.exe`) et `mountPath` (exclusivement
`/home/username/DBXV2`). Le profil exige une archive de même origine dont une
lecture `Range: bytes=0-3` renvoie exactement 206 et le bon `Content-Range`.
L'archive ZIP64 STORE virtuelle expose tous les fichiers sous ce chemin invité.
Le lanceur passe le programme en un seul argument et conserve les espaces des
chemins. Le moteur lit ensuite les blocs nécessaires via `bw64url`.

## Validation et limites

```powershell
bun test project/emscripten/dbxv2-profile.test.js tools/dbxv2/serve.test.ts
```

Les tests couvrent l'extraction par le lecteur ZIP indépendant de Bun, les CRC,
les offsets au-delà de 4 Gio, les lectures bornées et le contrat HTTP. Ces tests
ne prouvent pas que DBXV2 démarre ou qu'il est jouable. Le lancement réel, le
rendu DirectX, le son, la mémoire disponible dans WASM et les exigences Steam/EAC
restent à qualifier avec le moteur compilé dans Chrome. Une installation de
32 Go sur disque ne signifie pas que 32 Go de mémoire WASM sont disponibles.
Le serveur local et ce profil ne constituent pas un déploiement public qualifié.

## Compatibilité graphique constatée dans les sources

État du checkout initial `dee2ff3f08d9b5bdfe78c15bdefbf8f89b4f1639` :

- `README.md:333` décrit un interpréteur sans JIT, le pont OpenGL/WebGL2 et
  Direct3D 9 basique. `README.md:361` rapporte une première image du triangle
  D3D9 en deux à trois minutes ; ce n'est pas une preuve de performances du jeu.
- `tools/rootfs64/gltest/d3dtri.c:13` inclut `d3d9.h`. Le test fourni ne qualifie
  pas D3D11.
- `tools/rootfs64/libgl64/libgl64.c:445` annonce GL 2.1 et GLSL 1.20 ;
  `:469` documente les extensions retirées après échec de validation des formats.
  `:859` renvoie un no-op pour les fonctions GL inconnues : une résolution de
  symbole réussie ne prouve donc pas une implémentation fonctionnelle.
- `source/opengl/gl64bridge.cpp:619` traduit le GLSL 120/130 en GLSL ES 300.
  L'ABI `source/opengl/gl64bridge_abi.h` fournit shaders, buffers, textures et
  framebuffer, mais n'expose pas les fonctions d'instanciation, UBO
  `glBindBufferBase`, geometry/tessellation ou compute nécessaires à une
  couverture moderne plus large. Les besoins exacts du jeu restent à mesurer.
- `source/vulkan/vulkancommon.cpp:21` est gardé par `BOXEDWINE_VULKAN` et
  consomme SDL Vulkan natif. Ce code ne fournit pas un backend WebGPU au navigateur.
- `project/emscripten/Makefile:122` limite la cible `wasm64-mt` à
  `4294967296` octets et ne lui passe pas `-sMEMORY64`. Le **guest x86-64** est
  distinct de l'adressage **WASM32** du moteur et de sa limite de **4 Gio**.
  La cible de self-test memory64 est séparée (`Makefile:53`).

## Sonde D3D11 indépendante

`tools/dbxv2/probe-d3d11.c` charge dynamiquement `d3d11.dll`, appelle
`D3D11CreateDevice` avec le pilote matériel et affiche HRESULT, niveau de
fonctionnalités, présence du device et du contexte. Aucun fichier de jeu n'est
chargé ou modifié. Compilation avec un MinGW-w64 x86-64 déjà disponible :

```sh
x86_64-w64-mingw32-gcc -O2 -Wall -Wextra -o probe-d3d11.exe tools/dbxv2/probe-d3d11.c
```

Lancer cet EXE dans le lanceur Boxedwine64 standard pour une première mesure.
Codes de sortie : 0 = création réussie au niveau 11_0 ; 2 = DLL absente ;
3 = symbole absent ; 4 = création échouée ; 5 = niveau inférieur à 11_0.
Même le code 0 ne valide ni les shaders du jeu, ni sa présentation d'images,
ni sa jouabilité. L'ajout futur de fonctions au pont nécessite de reconstruire
le WASM ainsi que `libGL.so.1` et les rootfs correspondants.
