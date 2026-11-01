# Schietkaart Scorer – KKG 12 m liggend

Web-app die schietkaarten van foto's leest en de schoten waardeert volgens de KNSA-methodiek.
Draait volledig in de browser (geen server, geen installatie). Werkt op pc en telefoon.

## Gebruik

1. Open `index.html` in Chrome, Edge of Safari (of de Android-app).
2. Kies de reeks: **12 × 5** (grote kaarten met 5 visuelen) of **60 × 1** (kleine losse kaarten).
3. Maak of kies foto's. Een foto mag één kaart bevatten of meerdere naast elkaar (kleine kaarten in
   volgorde leggen: rijen van links naar rechts). Het kaarttype wordt automatisch herkend.
4. Grote kaarten worden automatisch rechtop gezet, zodat LB/RB/M/LO/RO altijd kloppen, hoe de foto ook
   gedraaid is. Herkenning via de papierrand (onder ≥ 70 mm, elders ≥ 40 mm) en de telstrook midden
   onder. Klopt het toch niet, gebruik dan "⟳ Draai".
5. Elk schot krijgt een **zekerheid**: de kans dat de waarde klopt, op basis van de meetonzekerheid en de
   afstand tot de ringgrens. Alleen schoten **onder 90%** en visuelen met 0 of meer dan 1 schot worden
   rood gemarkeerd. "Controleer n schoten" loopt ze één voor één langs.
6. In de editor sleep je de schotmaat precies over het kogelgat. Groene ring = geraakt, oranje
   stippellijn = net niet gehaald. Een verplaatst schot telt als gecontroleerd.
7. De datum van de serie komt uit de opnamedatum van de foto (EXIF) en is aan te passen.
8. Vink proefkaarten aan; die tellen niet mee. Vul eventueel de kaartnummers in: na kaart 1 en 2 vult de
   app de rest doorlopend aan. De naam van de schutter staat onder Instellingen.

## Uitvoer

- **Rapport (PDF)**: fototelling met kop en totaalbeeld (histogram, trefbeeld, MR, ø, Best Divider), series
  per kaart, alle losse schoten, controleoverzicht (LB/RB/M/LO/RO per kaart, bereik bij grensgevallen) en
  controlefoto's. Opslaan via het printvenster ("Opslaan als PDF"); in de app via het Android-printmenu.
  † = grensgeval (zekerheid < 90% en niet gecontroleerd).
- **CSV**: `Shot Number;Scan Number;Score;x;y`, alles tussen aanhalingstekens, decimale komma, x rechts en
  y boven positief in mm, volgorde per kaart LB, RB, M, LO, RO. Bestandsnaam `JJJJ-MM-DD_KKG_12m_liggend.csv`.
- **Kopieer uitslag**: korte tekst met totalen per kaart of serie.

## Android-app (APK)

`android\dist\SchietkaartScorer.apk` is dezelfde app als Android-app: werkt offline, heeft geen
internetpermissie, "Foto maken" opent de camera, "Foto's kiezen" de galerij (meerdere tegelijk),
"Deel CSV" opent het deelmenu en de terugknop sluit eerst de editor.

Installeren: zet de APK op je telefoon (USB-kabel, e-mail of Drive), open hem met Bestanden en sta
"installeren van onbekende apps" toe. Of via USB-foutopsporing:
`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r android\dist\SchietkaartScorer.apk`

Opnieuw bouwen na wijzigingen: `powershell -ExecutionPolicy Bypass -File android\build.ps1`
(gebruikt JDK 17 en Android SDK in `%LOCALAPPDATA%\Android`). Bewaar `android\keystore\schietkaart.jks`:
zonder die sleutel kan een nieuwe versie niet over de oude heen geïnstalleerd worden.

## Foto-tips

- Gebruik een **gekleurde of lichte ondergrond** (groen/rood papier), of houd de kaart tegen het licht.
  Op een donkere ondergrond zijn gaten in het zwart onzichtbaar.
- Zo recht mogelijk van boven, kaart groot in beeld, gelijkmatig licht. Een beetje scheef is geen
  probleem: de app corrigeert het perspectief.

## Waardering (KNSA Schiet- en Wedstrijdreglement deel III, art. 3.2.1)

Schijf: Klein Kaliber Schijf KNSA 12-meter model 1986, 5 visuelen per kaart (12 kaarten = 60 schoten).

| Ring | Ø (mm) | | Ring | Ø (mm) |
|---|---|---|---|---|
| 10 (witte punt) | 1,4 | | 5 | 20,0 |
| 9 | 2,7 | | 4 (rand zwart) | 25,0 |
| 8 | 6,8 | | 3 | 30,0 |
| 7 | 10,9 | | 2 | 35,0 |
| 6 | 15,0 | | 1 | 40,0 |

- 1 t/m 9: ring geraakt door de schotmaat → hoogste waarde.
- 10: de schotmaat bedekt de witte punt geheel.
- Mouche: het schot ligt geheel binnen de 8-ring.
- Schotmaat standaard Ø 5,6 mm (.22 LR), instelbaar.

Met d = afstand van het schotmiddelpunt tot het schijfmiddelpunt en g = halve schotmaat:
10 als d ≤ g − 0,7; waarde n (1–9) als d ≤ R(n) + g; mouche als d ≤ 3,4 − g.

## Hoe de herkenning werkt

1. Zwarte schijven (Ø 25 mm) zoeken en groeperen tot een kaart (vier hoeken + midden).
2. Perspectief van de kaart schatten uit de vijf schijven, daarna per visueel de rand van het zwart
   nauwkeurig fitten. Dat levert het middelpunt en de schaal in mm.
3. Rond elk visueel een rechtgetrokken uitsnede maken en kogelgaten zoeken als afwijking van de
   verwachte schijf (licht of gekleurd in het zwart, afwijkend in het wit).
4. De rand van het gat fitten met een cirkel → schotmiddelpunt → waarde.

## Testen

`test/synth.html` maakt synthetische kaartfoto's met bekende schoten (perspectief, ruis, onscherpte,
JPEG, verschillende ondergronden) en vergelijkt de herkenning met de waarheid.
`powershell -ExecutionPolicy Bypass -File test\run-tests.ps1` draait dit headless in Edge en maakt
screenshots van de app.

Resultaat op synthetische foto's: alle schoten correct gewaardeerd op lichte, gekleurde en
tegenlicht-ondergrond, ook bij flink scheef fotograferen. Gemiddelde fout van het schotmiddelpunt
0,01–0,05 mm, maximaal ca. 0,12 mm. Op donkere ondergrond worden gaten in het zwart gemist (gemeld).

## Beperkingen

- Nog niet getoetst op echte foto's: echte gaten zijn rafeliger dan gesimuleerde.
- Gaten die volledig in het wit liggen, op een witte ondergrond, zijn alleen aan de loodrand te
  herkennen. Die krijgen "laag vertrouwen" en worden ter controle gemarkeerd.
- Regels voor te veel schoten op een kaart of in één visueel worden niet automatisch toegepast;
  de app meldt het, de beoordeling ligt bij jou/de wedstrijdleiding.
- Uitslagen worden niet bewaard tussen sessies; exporteer ze.
