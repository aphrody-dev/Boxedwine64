# EAC Linux v2 — source officielle

[Annonce Epic du 14 octobre 2026](https://onlineservices.epicgames.com/news/introducing-easy-anti-cheat-linux-v2), consultée le 21 octobre.

Epic prévoit un pilote Fortnite avant diffusion à d'autres développeurs. L'activation
reste propre à chaque jeu ; cette page ne confirme pas DBXV2. Le système annoncé
combine un service systemd temporaire, eBPF, TPM 2.0, démarrage vérifié et mesuré,
signatures reconnues, IOMMU et restrictions du noyau.

Le support Wine/Proton décrit par Epic ne constitue pas une validation de
Boxedwine/WASM. Aucune installation EAC v2, modification du démarrage ou
désactivation de protection n'a été effectuée dans ce lot. La sortie Wine 53
observée reste un défaut à diagnostiquer indépendamment.

## Dépôt EAC Extractor Utility

Le [dépôt fourni par le propriétaire](https://github.com/lguilhermee/EAC-Extractor-Utility)
décrit un extracteur Windows de composants EAC. Son numéro de version 2.0 ne désigne
pas EAC Linux v2. La lecture de `EACExtractor.cpp` montre une sauvegarde du lanceur
déchiffré puis son chargement par `LoadLibraryA` avant extraction des composants.
Ce chemin exécute donc le chargement d'une DLL ; il ne se limite pas à lire ses octets.

Le dépôt peut documenter la structure des modules Windows. Il ne fournit ni un
pilote utilisable dans Chrome, ni le runtime Linux autorisé pour DBXV2, ni le pont
Direct3D/Vulkan/WebGPU. Seules ses sources ont été consultées dans cette vérification ;
aucun de ses exécutables ni module extrait n'a été lancé.
