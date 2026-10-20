# DBXV2 : DirectX 11, Vulkan et rendu Chrome

Recherche et lecture de sources primaires réalisées le **21 octobre 2026**.
Les résultats ci-dessous distinguent code présent, déclarations des projets et
tests effectivement exécutés dans notre environnement. Aucun nouveau dépôt n'a
été cloné pour cette recherche et aucun binaire du jeu n'a été modifié.

## Conclusion technique

Le frontal Direct3D 11 existe : Wine et DXVK savent prendre en charge cette API.
Le maillon manquant dans notre livraison navigateur est une traduction graphique
complète, exécutée et vérifiée entre ce frontal et WebGPU. Un nom de DLL, une
énumération de fonctionnalités ou une fonction qui renvoie succès ne constituent
pas cette traduction. Cette conclusion constate l'état des sources examinées ;
elle ne démontre aucune impossibilité absolue d'exécuter DBXV2 dans un navigateur.

La chaîne à construire sans réécrire le jeu est :

```text
DBXV2.exe + DLL et données originales
  → émulateur x86-64 + environnement Win64/Wine
  → frontal Direct3D 11 réellement compatible
  → traduction des commandes, ressources et shaders effectivement implémentée
  → WebGPU du navigateur → GPU du client
```

DXVK offre un chemin intermédiaire Vulkan ; ce choix exige ensuite un véritable
pilote Vulkan sur WebGPU, avec les capacités requises par la version de DXVK.
Une autre voie serait un backend WebGPU du frontal D3D11 existant. Les deux voies
restent des travaux d'intégration et de compatibilité, pas une conversion du jeu
en un nouveau moteur ni une simple option de compilation Emscripten.

## Besoins constatés dans nos binaires

L'analyse statique locale donne `DBXV2.exe` et `START.exe` en AMD64 (`0x8664`),
PE32+ (`0x020b`). START.exe n'impose donc pas à lui seul une hypothèse WoW64.
SHA-256 de START.exe :
`903e7aba292448d68976597efe3f0dc6f5cc66ef1889e3c1efcaf3eaf4e614d1`.

DBXV2.exe importe `xgcore.dll`, qui importe `dxgi!CreateDXGIFactory1`,
`d3d11!D3D11CreateDevice`, les fonctions de textures de `d3dx11_43.dll` et
`D3DCOMPILER_43!D3DReflect`. `render_pass_x64.dll` importe aussi `D3DReflect`.
Cela établit le besoin D3D11 ; cela ne prouve pas les feature levels, shaders
geometry/tessellation ou extensions effectivement utilisés pendant une partie.
Il faut les mesurer, et ne pas les supposer à partir des imports.

## Frontal et couches de traduction disponibles

### DXVK

[DXVK](https://github.com/doitsujin/dxvk) implémente D3D8/9/10/11 sur Vulkan.
La [version 3.1.1](https://github.com/doitsujin/dxvk/releases/tag/v3.1.1), publiée
le 15 septembre 2026, décrit des corrections concernant plusieurs jeux réels.
Ces preuves concernent les plateformes natives compatibles, pas Chrome.

La [page des pilotes](https://github.com/doitsujin/dxvk/wiki/Driver-support)
consultée indique pour 3.x Wine ≥10.1 et un profil Vulkan 1.4, avec notamment
depth clip, maintenance5/6, robustness2, transform feedback, descriptor indexing,
256 octets de push constants et plusieurs capacités de types entiers.
Une ancienne page indexée pour DXVK 2.7 ne doit pas être présentée comme la
configuration actuelle. Revenir à une ancienne version ne fournit pas à lui seul
le backend navigateur manquant.

### D3D11On12 et vkd3d

Microsoft précise que [D3D11On12, README lignes 3–19](https://github.com/microsoft/D3D11On12/blob/c6b5a961ee5e0761136fc2091b5e57f7bd9235f2/README.md#L3)
implémente le **DDI** du pilote D3D11, et dépend du runtime D3D11 qui le charge.
Il produit `d3d11on12.dll`, pas un remplacement autonome de `d3d11.dll`.
Il traduit ensuite vers D3D12 et s'appuie sur D3D12TranslationLayer.

[vkd3d-proton](https://github.com/HansKristian-Work/vkd3d-proton/blob/ef9a02e873715c9e2da0d6db8a236aca8380b303/README.md#L1)
implémente D3D12 sur Vulkan pour Proton. Ses exigences comprennent un profil
Vulkan moderne et de fortes capacités de descriptor indexing. Enchaîner
D3D11On12 puis vkd3d ajoute des couches sans supprimer le besoin final
Vulkan → WebGPU. Aucune validation navigateur de cette chaîne n'a été trouvée.
Le projet [vkd3d WineHQ](https://gitlab.winehq.org/wine/vkd3d) reste distinct de
ce fork ; sa présence ne constitue pas une implémentation WebGPU.

### wgpu, Dawn et conversion de shaders

[wgpu](https://github.com/gfx-rs/wgpu) expose une API issue de WebGPU avec des
backends natifs Vulkan/Metal/D3D12 et un backend navigateur WebGPU.
[Dawn](https://github.com/google/dawn/blob/main/docs/dawn/overview.md) implémente
également WebGPU au-dessus des API natives. Ces projets ne sont pas des pilotes
Vulkan entrants utilisables directement par DXVK.

[twgsl](https://github.com/BabylonJS/twgsl) expose la conversion SPIR-V → WGSL de
Tint à JavaScript. C'est une brique de compilation de shaders ; elle ne traduit
ni les ressources Vulkan, ni les commandes, ni leurs synchronisations.
Les shaders et les appels produits par DXVK doivent tous avoir une traduction
valide. Convertir une partie des shaders ne suffit pas à exécuter le jeu.

Les [immediates de Chrome 149–150](https://developer.chrome.com/blog/new-in-webgpu-149-150)
sont désormais documentées. L'ancienne affirmation générale « WebGPU n'a aucun
push constant » est donc dépassée. Leur disponibilité se détecte à l'exécution ;
elle ne prouve ni l'ensemble du profil Vulkan requis ni son implémentation dans
une bibliothèque utilisant une ancienne version de wgpu/Naga.

## Projets qui implémentent le sens Vulkan → WebGPU

### nikki : calcul réel, profil volontairement restreint

Révision examinée : `1986d81dc3fed711f8b8223148d913f70766ed0c`.
[README](https://github.com/nihui/nikki/blob/1986d81dc3fed711f8b8223148d913f70766ed0c/README.md),
[profil](https://github.com/nihui/nikki/blob/1986d81dc3fed711f8b8223148d913f70766ed0c/docs/vulkan-profile.md),
[tests](https://github.com/nihui/nikki/blob/1986d81dc3fed711f8b8223148d913f70766ed0c/docs/testing.md).

Le projet traduit un sous-ensemble Vulkan compute sur buffers vers Dawn/WebGPU,
avec Tint pour les shaders. Il contient des tests d'API, durées de vie, soumission,
traduction et une intégration ncnn comprenant un parcours navigateur.
Son contrat exclut explicitement images, samplers et pipelines graphiques et
déclare l'absence de conformité Vulkan complète. Il fournit donc des composants
et des méthodes de validation utiles, sans constituer le backend graphique DXVK.
Nous avons lu ces tests ; nous ne les avons pas exécutés.

### VkWebGPU-ICD : prototype graphique à auditer au niveau du code

Révision examinée : `2202e49d617877b2a114b575a3e22777910b2e5b`.
Le [README](https://github.com/Dankular/VkWebGPU-ICD/blob/2202e49d617877b2a114b575a3e22777910b2e5b/README.md)
annonce un triangle natif fonctionnel, mais laisse l'intégration navigateur et
la compatibilité DXVK dans les étapes de développement. Son appréciation
« production-ready » ne remplace pas une preuve d'exécution du jeu.

Constats vérifiables :

- [device.rs, lignes 78–84](https://github.com/Dankular/VkWebGPU-ICD/blob/2202e49d617877b2a114b575a3e22777910b2e5b/vkwebgpu/src/device.rs#L78) : la branche de création du backend WASM peut retourner une erreur explicite d'implémentation manquante.
- [pipeline.rs, lignes 235–254](https://github.com/Dankular/VkWebGPU-ICD/blob/2202e49d617877b2a114b575a3e22777910b2e5b/vkwebgpu/src/pipeline.rs#L235) : création du pipeline wgpu limitée par compilation conditionnelle au natif ; la voie WebX sérialise les commandes séparément.
- [pipeline.rs, lignes 373–379](https://github.com/Dankular/VkWebGPU-ICD/blob/2202e49d617877b2a114b575a3e22777910b2e5b/vkwebgpu/src/pipeline.rs#L373) : les étapes geometry/tessellation sont ignorées avec avertissement au lieu d'être émulées. Cela n'est pas une prise en charge fidèle si le jeu les utilise.

### WebX : transport présent, preuve de jeu encore absente

Révision examinée : `b907fd555ed1fa07eb2c299c79281c2330a96e91`.
Le [README, état courant](https://github.com/Dankular/WebX/blob/b907fd555ed1fa07eb2c299c79281c2330a96e91/README.md#L202)
décrit Canary, Proton, un ICD invité et un pont vers le navigateur. Il marque
encore le rendu complet d'un jeu comme travail en cours.

Dans [vkwebgpu-plugin.mjs, lignes 891–909](https://github.com/Dankular/WebX/blob/b907fd555ed1fa07eb2c299c79281c2330a96e91/harness/vkwebgpu-plugin.mjs#L891),
le handler cherche une fonction externe `globalThis.spirvToWgsl`. Si elle manque
ou échoue, le module GPU reste nul et le handler retourne quand même succès.
L'arbre examiné ne fournit pas le traducteur correspondant. Il faut brancher et
tester cette fonction et propager ses erreurs avant de considérer ce parcours
comme une exécution graphique valide. Un triangle natif du projet compagnon
n'est pas une preuve de DBXV2 ou d'un autre jeu Windows complet dans Chrome.

## ProGPU : API utilisable par du code, façade native encore générée

Révision vérifiée : `f8199d115c105f73ce6b1eda079081bce0d099f4`.
[ProGpuDirectXDevice](https://github.com/wieslawsoltes/ProGPU/blob/f8199d115c105f73ce6b1eda079081bce0d099f4/src/ProGPU.DirectX/ProGpuDirectXDevice.cs)
expose une construction à partir d'un contexte wgpu ; cela doit être distingué
d'un runtime ABI D3D11 que chargerait un EXE Win64 existant.

L'[émetteur de façade, lignes 199 et suivantes](https://github.com/wieslawsoltes/ProGPU/blob/f8199d115c105f73ce6b1eda079081bce0d099f4/src/ProGPU.DirectX/ProGpuDirectXNativeFacadeSourceEmitter.cs#L199)
documente expressément une structure NativeAOT initiale qui exporte les symboles
avant de les relier aux implémentations. Les valeurs retournées par défaut,
dont zéro pour certains types, ne prouvent pas que les opérations DirectX sont
exécutées. Il reste à qualifier les objets COM, ressources, shaders et commandes
derrière chaque export utilisé. Ce constat vise cette façade, pas l'ensemble des
capacités internes de ProGPU.

## Séquence de validation réalisable sans modifier le jeu

1. Conserver l'émulation x64, Wine64, les DLL originales nécessaires et les CPK
   accessibles par ZIP64/Range. Les corrections de lecture ne prouvent pas le rendu.
2. Exécuter le probe D3D11 du dépôt : HRESULT, adapter, feature level réel,
   création des ressources, shader minimal, pixels lus en retour. Échouer
   explicitement lorsque la capacité manque.
3. Choisir un seul backend propriétaire. Pour DXVK, qualifier d'abord l'ICD
   Vulkan/WebGPU et les shaders produits, puis le pont invité/hôte de Boxedwine.
   Réutiliser les traducteurs existants, sans succès artificiel ni shader omis.
4. Mesurer les fonctionnalités réellement demandées par DBXV2 ; implémenter ou
   émuler les lacunes observées, avec tests séparés. Les contraintes éventuelles
   Steam/EAC et l'exécution CPU restent des axes indépendants du rendu graphique.
5. Qualifier dans Chrome le lancement, menu, chargement, scène jouable, audio et
   commandes. Publier les résultats observés et les erreurs exactes. Aucun des
   dépôts examinés ne fournit à lui seul cette preuve pour DBXV2.

Ces étapes proposent un développement possible. La recherche n'a établi ni une
solution complète prête à brancher, ni une impossibilité générale.
