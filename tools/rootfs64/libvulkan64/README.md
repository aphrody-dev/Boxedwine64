# Transport VK64

Ce dossier contient un client de transport x86-64, pas une fausse libvulkan : aucun export Vulkan ou device inventé. Le véritable ICD reste VkWebGPU-ICD ; appliquer le patch versionné `tools/dbxv2/patches/vkwebgpu-boxedwine-vk64.patch` à son SHA `2202e49d617877b2a114b575a3e22777910b2e5b` puis activer `BOXEDWINE_VK64=1` dans le processus invité. Le patch préserve les sérialiseurs WebX et le chemin ports par défaut.

L'hôte installe `vk64SetDispatch(start, abort)`. Start reçoit un token et le paquet WebX possédé, doit retourner rapidement et terminer par `vk64Complete(token, response)`. Abort doit être non bloquant, ne pas réentrer dans le pont et libérer les ressources du backend ; il est appelé sous verrou à l'annulation, à l'expiration et au remplacement du backend. La completion tardive est ignorée. Aucun backend n'est installé par défaut : SUBMIT retourne ENODEV.

L'expiration de 30 secondes est balayée lors des appels du pont/completions. Quatre pending globaux, une requête par CPU64 ; les réponses retenues sont bornées à 64 MiB. Le backend doit lui aussi borner sa file et respecter abort. La validation des permissions puis la copie KMemory64 ne sont pas une transaction contre munmap concurrent : limitation existante de l'API mémoire, à durcir avant exécution invitée hostile.

Le test `probe-vk64-test.cpp` vérifie le vrai transport avec adaptateur mémoire déterministe et backend de test, sans GPU. `probe-vk64.c` est une vraie sonde ELF64 : mappe au-delà de 4 GiB et vérifie ENODEV, EFAULT et EMSGSIZE dans Boxedwine. Elle ne lance aucun jeu.
