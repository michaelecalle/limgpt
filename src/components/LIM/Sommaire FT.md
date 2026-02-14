Sommaire FT.tsx (Espagne) — ultra-court

L1–79 : Imports + types + states principaux + listener lim:gps-state

L80–224 : handleScroll + calcul visibleRows + gestion scroll manuel/auto

L229–616 : Contexte train / sens / refs bases (autoScrollBase, recalage…)

L618–922 : Barre position (trainPosYpx) : GPS/Horaire/fallback sur activeRow

L926–1227 : GPS qualité / watchdog / garde-fous PK + bascule referenceMode

L1234–1299 : Play/Pause/Standby (pilotage TitleBar / test)

L1327–1698 : Moteur HORAIRE → activeRowIndex (heure effective, delta, recalage)

L1704–1757 : Auto-scroll DOM sur .ft-active-line (recentrage écran)

L2059–2963 : Moteur GPS → activeRowIndex (projection PK→index + ancrage)

L4692–5373 : JSX final + styles + <FTScrolling> + overlay



Cartographie simplifiée de FT.tsx (Espagne)
0) En-tête + init composant + états principaux

Lignes 1 → 24 : Imports + types de base

Lignes 25 → 79 : Début composant FT, states principaux (activeRowIndex, referenceMode, gpsStateUi, etc.) + listener lim:gps-state (bascule GPS/Horaire)

1) Scroll & viewport (mécanique “scroll utilisateur / auto-scroll”)

Lignes 80 → 224 : handleScroll()
→ détecte scroll manuel vs programmatique, met à jour visibleRows, gère le timer de “retour auto” après scroll manuel

2) Contexte train / vue ES-FR / évènements TitleBar

Lignes 229 → 589 :

“Numéro de train & portion de parcours”

Mode vue FT (ES/FR)

Réception d’évènements externes (conc, expected direction, etc.)

Prépare les bases nécessaires au moteur

3) Base horaire + refs recalage + nettoyage sélection

Lignes 590 → 616 :

autoScrollBaseRef (base temporelle)

recalibrateFromRowRef, lastAnchoredRowRef, etc.

nettoyage sélection quand on repasse en GPS

4) ✅ Barre de localisation (position Y continue) — GPS/Horaire/fallback

Lignes 618 → 922 :

scrollContainerRef

trainPosYpx + logique continuité ORANGE→RED

useEffect tick() qui calcule la position Y en px

GPS : interpolation PK→Y

Horaire : interpolation temps→Y

fallback : sur activeRowIndex

5) GPS : qualité / watchdog / garde-fous / cohérence direction

Lignes 926 → 1174 :

Réfs GPS (lastGpsPositionRef, freeze, stale, etc.)

Watchdog GPS (setInterval) → calcule l’état GREEN/ORANGE/RED + dispatch lim:gps-state + bascule referenceMode

Lignes 1193 → 1227 :

garde-fou “saut de PK” (PK incohérent)

Lignes 1209 → 1227 :

cohérence sens attendu vs sens observé GPS

6) Bouton Play/Pause + Standby + moteur horaire “ligne active”

Lignes 1234 → 1299 : gestion Play/Pause venant TitleBar (standby initial etc.)

Lignes 1303 → 1323 : event ft:standby:set (simulation/replay)

⭐ Bloc HORAIRE qui calcule activeRowIndex

Lignes 1327 → 1698 : moteur horaire updateFromClock()
→ construit autoScrollBaseRef, calcule heure effective, détermine activeRowIndex

⭐ Bloc AUTO-SCROLL (scroll programmatique sur la ligne active)

Lignes 1704 → 1757 : auto-scroll DOM (recentrage écran sur .ft-active-line)

7) Logique métier sens / sélection parcours / découpe / données FT

Lignes 1760 → 1790 : logique métier de sens (UP/DOWN)

Lignes 1791 → 2965 : sélection + orientation + tronquage du parcours
→ très gros bloc data (CSV, sens, mapping, etc.)

⭐ Bloc GPS qui pilote activeRowIndex

Lignes 2059 → 2963 : listener gps:position
→ met à jour lastGpsPositionRef, calcule index GPS projeté, et quand mode GPS actif : setActiveRowIndex(idx) + logique d’ancrage

8) Remarques rouges / timeline / construction du tableau

Lignes 2966 → 3015 : helpers “remarques rouges”

Lignes 3016 → 3131 : timeline vitesse / points de rupture

Lignes 3132 → 4688 : construction du <tbody> (rows DOM)

Lignes 3439 → 3573 : horaires théoriques (interpolation PK↔temps)

Lignes 3574 → 4688 : horaires théoriques en secondes (mode test) + finalisation rows

9) Rendu final (JSX complet + styles + FTScrolling)

Lignes 4692 → 5373 : return(...) + CSS + render header + <FTScrolling> + overlay