# Compression DBXV2 : mesure bornée et décision

Mesure du 21 octobre 2026 sur la fabrique VPS, Bun Aphrody
1.4.6-canary.1 `fd9d7a224`, un seul travailleur pendant une compilation concurrente.
Aucune dépendance installée, aucun CPK modifié. Le script
`benchmark-compression.ts` lit 1 Mio au début, au milieu et à la fin de quatre
CPK réels : 12 Mio au total. Il mesure les API natives Bun zstd niveaux 3/9/19
et CompressionStream Brotli avec les paramètres par défaut du runtime.
Chaque décompression est vérifiée par SHA-256 contre l'échantillon original.
Les octets du jeu ne sont ni enregistrés ni imprimés.

Les valeurs ci-dessous agrègent trois échantillons par archive. Ratio = taille
compressée / taille originale ; temps en millisecondes pour les trois échantillons.

| Archive | Codec | Ratio | Compression ms | Décompression ms |
|---|---|---:|---:|---:|
| data.cpk | zstd 3 | 0,8377 | 23,3 | 3,1 |
| data.cpk | zstd 9 | 0,8332 | 83,8 | 3,8 |
| data.cpk | zstd 19 | 0,7900 | 717,8 | 8,1 |
| data.cpk | Brotli défaut | 0,7351 | 9163,0 | 49,2 |
| movie.cpk | zstd 3 | 0,8840 | 20,8 | 2,9 |
| movie.cpk | zstd 9 | 0,8820 | 72,9 | 7,2 |
| movie.cpk | zstd 19 | 0,8688 | 615,9 | 6,8 |
| movie.cpk | Brotli défaut | 0,8575 | 5685,1 | 44,2 |
| data_d7_bgm2.cpk | zstd 3 | 0,9954 | 8,8 | 0,6 |
| data_d7_bgm2.cpk | zstd 9 | 0,9955 | 34,8 | 1,3 |
| data_d7_bgm2.cpk | zstd 19 | 0,9928 | 660,6 | 3,4 |
| data_d7_bgm2.cpk | Brotli défaut | 0,9925 | 4574,6 | 20,3 |
| data2.cpk | zstd 3 | 0,8482 | 146,4 | 1,8 |
| data2.cpk | zstd 9 | 0,8473 | 31,7 | 1,8 |
| data2.cpk | zstd 19 | 0,8409 | 499,8 | 3,6 |
| data2.cpk | Brotli défaut | 0,8384 | 4254,5 | 35,6 |

Une seule passe, sans échauffement : ce ne sont ni des débits maximaux ni une
estimation pondérée du corpus entier. Le temps zstd 3 de data2 dépasse celui
du niveau 9 pendant cette mesure ; la charge concurrente interdit d'en tirer
une comparaison de vitesse isolée. Les milieux et fins restent des fenêtres
contiguës, sans classification des ressources internes.

## Choix concret

Pour livrer rapidement le jeu avec le lecteur actuel, conserver ZIP64 STORE et
HTTP Range en identité. Le nouveau seek STORE lit directement la plage demandée,
sans parcourir les gigaoctets précédents. Ne pas appliquer un Content-Encoding
global au ZIP adressé par ses offsets non compressés : les plages HTTP se
rapportent aux octets de la représentation encodée, selon
[RFC 9110 §14.1.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.1.2).
Des variantes HTTP compressées de ressources complètes peuvent être négociées
séparément, avec Vary et ETag propres ; les requêtes Range restent en identité.

Pour une prochaine couche CDN compressée, proposer des blocs indépendants de
1 Mio en zstd niveau 3, précalculés et mis en cache. Conserver le bloc brut lorsque
le gain est inférieur à 2 % : les échantillons BGM justifient ce repli. Le niveau
19 et Brotli défaut gagnent surtout sur data.cpk mais coûtent beaucoup plus à
produire ; ils ne sont pas le choix pour une compression à la demande.

Le [format seekable officiel Zstandard](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/zstd_seekable_compression_format.md)
décrit des frames indépendantes et une table des tailles compressées/décompressées.
Réutiliser ce format et son décodeur existant, avec contrôle d'intégrité par bloc,
plutôt qu'inventer une nouvelle représentation. Le client doit traduire chaque
offset logique en plage encodée et décompresser seulement les frames nécessaires.
Cette couche n'est pas implémentée ni qualifiée par ce benchmark ; la présence de
zstd dans Bun ne prouve pas sa disponibilité dans le navigateur ou minizip WASM.

## Reproduction

```sh
bun tools/dbxv2/benchmark-compression.ts /chemin/jeu/cpk /chemin/prive/compression-samples.json
```

Le rapport JSON contient uniquement des noms d'archives, positions, tailles et
temps. L'exécution de référence est conservée hors dépôt sous
`/home/ubuntu/build/boxedwine64-dbxv2/compression-samples.json`.
