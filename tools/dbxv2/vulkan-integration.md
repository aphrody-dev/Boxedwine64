# Raccordement Vulkan x64 invité → navigateur

État du 21 octobre 2026, `C:/src/Boxedwine64`. Ce document distingue les composants présents du raccordement restant à qualifier.

## Raccordement réalisé et preuves bornées

Le syscall VK64 possède désormais un transport x64 borné, une sonde ELF64 et un backend navigateur asynchrone. Le moteur WASM `5b376dc7e3e5e31b4c9823305c7fb2d6772305772f278997bccbdccc84ac84c7` expose les points d'entrée VK64. Dans Chrome, la sonde ELF64 a réellement soumis un pointeur `0x100020000`, obtenu `-ENODEV` sans backend, puis terminé avec le statut zéro. Le test C++ de conformité passe également ; il ne contient aucun GPU.

`vk64-bootstrap.js` réutilise le propriétaire Bun OS : Naga, le plugin WebX et `VkBridge`. L'activation reste explicite et exige un véritable adaptateur WebGPU. Les annulations, limites de taille, réponses malformées, erreurs de validation et pertes du device font échouer la requête. Cette source n'est pas encore une qualification de l'ICD invité.

Le triangle du propriétaire, émis depuis le navigateur, a passé la lecture réelle des pixels GPU : centre `[255,0,0,255]`, fond `[0,0,0,255]`, aucune erreur WebGPU non capturée. Ce résultat ne traverse pas encore l'ICD invité. Le contrôle Cargo de l'ICD `2202e49` avec le transport VK64 passe ; sa combinaison avec le correctif producteur WebX `8bd8125` et son chargement invité restent en cours. Ni DXVK ni le menu, les commandes et l'audio de DBXV2 ne sont qualifiés.

## Chemin nécessaire

DBXV2 Win64 → DLL D3D11/DXGI de DXVK x64 → winevulkan → bibliothèque Vulkan ELF x86-64 invitée → transport de commandes Boxedwine x64 → traducteur Vulkan/WebGPU côté navigateur → GPUDevice/Canvas WebGPU.

La couche Wine/DXVK produit des appels Vulkan ; elle ne parle pas directement à WebGPU. Les handles et adresses invités ne peuvent pas être transmis comme pointeurs hôtes. Les shaders SPIR-V doivent également être traduits et validés. Un triangle WebGPU ne démontre ni les extensions Vulkan requises par DXVK, ni cette chaîne invitée.

## Ce qui existe

- `tools/vulkan/buildvk.sh:2–3` construit la bibliothèque invitée `libvulkan.so.1` avec `-m32`.
- `tools/vulkan/vk.c:8–33` transporte les appels avec `int $0x9a`, pile ESP et arguments U32. Les fonctions retournant U64 utilisent EAX/EDX : cela reste une ABI invitée 32 bits, pas une ABI x64.
- `source/emulation/cpu/decoder.cpp:3875` reconnaît le trap Vulkan historique.
- `source/vulkan/vk_host.cpp:14–32` récupère les arguments via `peek32`; adresses et tables de handles sont U32.
- `source/vulkan/vk_host_marshal.cpp:14–29` lit sType et pNext à pas de quatre octets. Une structure Vulkan LP64 exige un autre layout, notamment alignement/pNext. Remplacer simplement U32 par U64 serait incorrect.
- Le générateur `tools/vulkan/gen/src/boxedwine/org/data/VkType.java:23–67` et `writers/VkHost.java:111,166` sont explicitement fondés sur Linux invité 32 bits. Il faut faire évoluer le générateur, plutôt que modifier manuellement les gros fichiers générés.
- `source/vulkan/vulkancommon.cpp:447–467` charge un Vulkan **hôte natif** avec SDL_Vulkan_LoadLibrary/GetVkGetInstanceProcAddr. Les procédures sont résolues depuis ce loader ; ce n'est pas un backend navigateur.
- `vulkancommon.cpp:474–508` initialise la table historique int9A sous BOXEDWINE_VULKAN. Sans ce define, callVulkan aboutit à une erreur explicite. Les headers Vulkan récents et les nombreux enums marshallés ne prouvent pas un backend WebGPU.

## Le précédent utile : GL64

`source/opengl/gl64bridge_abi.h:16–35` définit déjà une ABI partagée C invité/hôte, un numéro de syscall privé, un bloc d'arguments fixes et des slots 64 bits. `source/kernel/syscall64.cpp:2902–2909` route ce syscall vers gl64Bridge. C'est le patron concret à réutiliser pour un transport Vulkan **distinct**, sans réinterpréter les opérations GL comme des opérations Vulkan.

Le build `project/emscripten/makefile:63–68,122` active BOXEDWINE_OPENGL et les options LEGACY_GL_EMULATION/MAX_WEBGL_VERSION=2, offscreen canvas et pthreads. Le nom de cible wasm64-mt concerne l'émulation invitée x64 ; son MAXIMUM_MEMORY est 4 GiB. Ce fichier ne raccorde ni BOXEDWINE_VULKAN ni un backend WebGPU. Une ABI Vulkan invitée 64 bits doit donc conserver la distinction adresse invitée, adresse mémoire WASM et handle objet navigateur.

## Premier changement utile, borné et vérifiable

Ajouter une ABI VK64 et une bibliothèque invitée ELF64 séparée, en réutilisant le patron GL64 : numéro de syscall propre, version du protocole, taille bornée du paquet, slots U64, validation des plages mémoire, table de handles typés. Commencer par une sonde ELF64 qui interroge la version du transport puis les capacités **réelles** du backend. Tester un pointeur invité supérieur à 4 GiB pour détecter toute troncature avant d'ajouter les structures complexes.

Ce premier lot doit retourner explicitement « backend absent » si aucun GPUDevice/traducteur n'est prêt. Il ne doit ni annoncer Vulkan 1.x fictif ni retourner VK_SUCCESS sans effet. Il rend le chemin invité testable ; il ne suffit pas à faire démarrer DXVK.

Ensuite, choisir une interface de backend avec un traducteur réellement implémenté. Brancher successivement création instance/device, buffers/mémoire, shaders/pipelines, commandes/synchronisation et présentation. Les structs LP64, pNext, tableaux imbriqués et callbacks nécessitent un marshalling généré et testé. Le chargement asynchrone de WebGPU doit être résolu avant les appels synchrones invités ; les threads doivent utiliser un propriétaire GPU et un transport de commandes défini.

La bibliothèque invitée doit exposer exactement la forme attendue par winevulkan : soit libvulkan.so.1 avec les exports/proc-address requis, soit loader Vulkan accompagné d'un véritable ICD. Installer les DLL DXVK seul ne remplit aucun de ces contrats.

## Portes de qualification

1. Sonde ELF64 : transport, erreurs, pointeurs >4 GiB et énumération honnête.
2. Même sonde via winevulkan : instance/device et propriétés cohérentes.
3. Petit programme Vulkan invité : buffer, shader, rendu puis lecture des pixels, erreurs WebGPU et synchronisation vérifiées.
4. DXVK : son journal confirme le device et les extensions nécessaires ; la sonde D3D11 atteint réellement le feature level attendu.
5. DBXV2 réel : chargement, images, contrôles, audio et stabilité mesurés séparément.

Un triangle à l'étape 3 n'est pas un ICD complet et ne valide pas l'étape 4. La preuve actuelle fournie par le parent reste Wine/OpenGL créant un appareil D3D11 FL9.1 ; aucune exécution DBXV2 complète ni voie DXVK/WebGPU n'est démontrée. Voir aussi `graphics-research.md` pour les limites sourcées des traducteurs Vulkan/WebGPU existants.
