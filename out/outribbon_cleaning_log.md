# Nettoyage ruban LGV — Validation humaine (session du soir)

## État global
Paquets validés : 1 → 36

Objectif :
Extraction du chemin principal du ruban OSM densifié pour stabiliser la projection PK.

## Règles de sélection appliquées
- Continuité longitudinale prioritaire
- Branche la plus longue privilégiée
- Décalage latéral acceptable (~15–20 m)
- Suppression des zigzags / branches parasites OSM
- Zones tunnel validées par cohérence globale (ex : Gérone)
- En cas de branches quasi fusionnées : une seule conservée

## Décisions spécifiques
26 : douteux (géométrie incohérente)
29 : conserver branche passant par 3960 / 4011 / 4220
31 : conserver branche contenant 11387
32 : privilégier ligne haute (10136–10137)
33 : conserver branche passant par 9615
34 : conserver segments 6014 et 6138 (5986 / 6067 / 6102 exclus)
35 : conserver branche la plus longue
36 : conserver branche passant par 3274

## Notes importantes
- Plusieurs validations autour de Gérone concernent une LGV souterraine : décalage visuel normal.
- Le ruban final sera “magnétique latéralement”, donc la précision longitudinale prime sur l’alignement exact.
