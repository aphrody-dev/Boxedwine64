# Transport invité WebX vers Boxedwine VK64

Patch exclusivement contre WebX au commit
`b907fd555ed1fa07eb2c299c79281c2330a96e91`, fichier
`guest-icd/src/vkwebx.c`. Le checkout propriétaire
`C:/src/bun-os/vendor/webx` est resté intact.

Dans une copie isolée de cette révision :

```sh
git apply --check /chemin/Boxedwine64/tools/dbxv2/patches/webx-guest-icd-boxedwine-vk64.patch
git apply /chemin/Boxedwine64/tools/dbxv2/patches/webx-guest-icd-boxedwine-vk64.patch
```

Activer uniquement pour un invité Linux x86-64 Boxedwine avec
`-DBOXEDWINE_VK64=1` dans les options C du build ICD existant. Sans cette macro,
le transport I/O original reste actif. Avec elle, aucun `ioperm`, `iopl`, `inb`,
`inl` ou `outb` n'est exécuté.

## Contrat précis

Le syscall privé `0x564b0000` suit `source/vulkan/vk64bridge_abi.h` de Boxedwine :
RDI = opération, RSI = pointeur, RDX = longueur ; RAX est un entier signé.
Le wrapper assembleur conserve les errno négatifs, sans conversion libc.

- `SUBMIT=1` : paquet WebX existant de 16 octets d'en-tête suivi du payload ;
  retour attendu zéro.
- `POLL=2` avec pointeur et longueur nuls : taille de réponse ou `-EAGAIN`.
  Un second POLL avec le tampon copie et consomme la réponse.
- `CANCEL=3` : libère une requête en cours après erreur ou expiration.

Requête et réponse complètes sont bornées à 16 Mio. L'en-tête de réponse reste
`seq:u32`, `result:i32`, `len:u32` en little-endian (12 octets). Séquence et
longueur sont contrôlées ; le résultat Vulkan signé est préservé. Le mutex
existant couvre soumission, attente et consommation. La limite monotone de
25 secondes part avant SUBMIT ; POLL attend par tranches de 0,5 ms.

Même `webx_send`, historiquement sans attente, consomme désormais sa réponse
dans ce mode. Le backend Boxedwine doit terminer **chaque** soumission, y
compris les commandes void ; aucune réponse de succès n'est fabriquée dans
l'ICD. Une erreur transport ou une erreur Vulkan d'une commande void empoisonne
le canal, journalise l'erreur et fait échouer les prochains appels synchrones
avec `VK_ERROR_DEVICE_LOST`. Recréer le processus invité pour réinitialiser ce
canal ; aucune reprise silencieuse après perte de synchronisation.

## Portée et validation

Framing, serializers Vulkan, listes de capacités et WSI ne sont pas réécrits.
Les allocations internes des serializers existants restent à qualifier : ce
patch borne le paquet au point de transport, pas leur construction préalable.
Les résultats ne prouvent ni une implémentation Vulkan complète ni DBXV2 jouable.

`git apply --check` a réussi contre une copie exacte du fichier propriétaire dans
`C:/Users/aphro/AppData/Local/Temp/webx-vk64-patch`, dont `guest-icd/` est ignoré
par `.git/info/exclude`. Aucun build VPS ni installation ICD n'a été lancé.
La compilation et les essais transport submit/poll/cancel restent à exécuter
avant utilisation du patch.
