<p align="center"><img src="build/icon.png" width="128" height="128" alt="Transcrilator-Logo"></p>

# Transcrilator

Lokaler Englisch-Deutsch-Übersetzer für Transkripte. Fügt ein englisches Transkript ein und erhält eine vollständige, sauber gegliederte deutsche Übersetzung mit Absätzen, fetten Überschriften und kursiven Kernaussagen. Die App läuft komplett auf dem eigenen Rechner und nutzt das **eigene** Abo jeder Person:

- **Claude** (voreingestellt) über das offizielle, separat installierte [Claude Code](https://code.claude.com/docs/en/overview) mit eigenem Claude-Plan
- **ChatGPT** über die offizielle OpenAI-Anmeldung mit eigenem ChatGPT-Plan

Es gibt keinen eigenen App-Login, keine API-Key-Eingabe und keine API-Ausweichroute. MIT-lizenziert.

## Installation mit Claude Code (empfohlen fürs Team)

Diesen Prompt in Claude Code einfügen. Claude Code lädt dann die neueste Version, installiert sie und führt durch die Anmeldung:

```text
Installiere mir bitte die Desktop-App „Transcrilator“ von https://github.com/study-academy/transcrilator und führe mich durch die Einrichtung. Antworte auf Deutsch und erkläre jeden Schritt kurz.

1. Prüfe, dass ich macOS auf Apple Silicon nutze (`uname -m` muss arm64 ergeben). Bei einem Intel-Mac brich ab und verweise auf die Browser-Variante im README.
2. Lade die neueste Version: https://github.com/study-academy/transcrilator/releases/latest/download/Transcrilator-macOS-arm64.dmg nach ~/Downloads. Hole dir den erwarteten SHA-256-Wert dieser Datei aus https://api.github.com/repos/study-academy/transcrilator/releases/latest (Feld `digest` des Assets) und vergleiche ihn mit `shasum -a 256`. Stimmt er nicht, brich ab.
3. Hänge die DMG ein, kopiere Transcrilator.app nach /Applications (eine vorhandene Transcrilator.app vorher nach Rückfrage ersetzen) und werfe die DMG wieder aus.
4. Prüfe, ob das Claude-Code-Kommandozeilenprogramm verfügbar ist (`command -v claude`). Falls nicht, installiere es mit dem offiziellen Befehl `curl -fsSL https://claude.ai/install.sh | bash`.
5. Prüfe mit `claude auth status`, ob ich mit meinem eigenen Claude-Abo angemeldet bin (loggedIn true und authMethod "claude.ai"). Falls nicht: Ich soll in meinem eigenen Terminal `claude auth login --claudeai` ausführen und mich im Browser mit meinem Abo anmelden. Melde mich nicht selbst an, lies keine Tokens und richte keinen API-Key ein. Prüfe danach den Status erneut.
6. Öffne die App mit `open -a Transcrilator`. Falls macOS sie blockiert, erkläre mir: Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“.
7. Sag mir zum Schluss: In den Einstellungen (⌘ ,) sollte bei Claude ein grüner Punkt stehen. Text mit ⌘ V einfügen, mit ⌘ ↩ übersetzen; das Ergebnis landet automatisch in der Zwischenablage. ChatGPT ist optional über „Continue with ChatGPT“ in den Einstellungen.
```

## Installation (macOS)

1. [`Transcrilator-macOS-arm64.dmg`](https://github.com/study-academy/transcrilator/releases/latest/download/Transcrilator-macOS-arm64.dmg) laden (immer die neueste Version, für Macs mit Apple Silicon, M1 und neuer). Für Intel-Macs gibt es vorerst keine fertige App; dort die Browser-Variante nutzen oder selbst mit `npm run dist:mac` bauen.
2. DMG öffnen und `Transcrilator` in den Ordner `Programme` ziehen.
3. Die App ist nicht von Apple signiert. Beim ersten Start meldet macOS deshalb, dass die App nicht geöffnet werden kann. Dann einmalig: **Systemeinstellungen → Datenschutz & Sicherheit → nach unten scrollen → „Dennoch öffnen“** und mit dem eigenen Mac-Passwort bestätigen. Danach startet sie normal.

Windows und Linux sind nicht gebaut und nicht getestet. Dort funktioniert die Browser-Variante (siehe unten).

Wenn die App schon installiert ist und eine neue Version erscheint: neue DMG laden und die alte App in `Programme` ersetzen. Einstellungen bleiben erhalten.

## Claude einrichten (einmalig pro Person)

1. Claude Code nach der [offiziellen Anleitung](https://code.claude.com/docs/en/setup) installieren, zum Beispiel im Terminal:
   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   ```
2. Mit dem **eigenen** Claude-Abo anmelden (Pro, Max, Team oder Enterprise):
   ```sh
   claude auth login --claudeai
   ```
   Die Anmeldung läuft vollständig in Anthropics eigenem Browser-Login. Die App sieht keine Passwörter oder Tokens.
3. Transcrilator öffnen. Ist beim ersten Start noch kein Modell verbunden, öffnen sich die Einstellungen automatisch; später zeigt die leere Karte „Claude ist nicht verbunden“ mit `Jetzt verbinden`. Unter Einstellungen (Symbol oben mittig) zeigt der Anbieter-Schalter `Claude | ChatGPT` dann bei Claude einen grünen Punkt und darunter „Verbunden über dein Claude-Abo“. Gelb heißt: noch nicht mit dem Abo angemeldet; rot: Claude Code nicht gefunden. `Neu verbinden` öffnet auf dem Mac das Terminal mit dem offiziellen `claude auth login`; beim ersten Mal fragt macOS, ob Transcrilator das Terminal steuern darf.

Die App akzeptiert nur die Abo-Anmeldung (`claude.ai`). Ein API-Key, Bedrock/Vertex oder fremde Zugangsdaten werden nicht verwendet, und kostenrelevante Umgebungsvariablen werden nicht an Claude Code weitergegeben. Übersetzungen zählen gegen das Nutzungslimit des eigenen Abos. Jede Person braucht ein eigenes Abo; Zugänge dürfen nicht geteilt werden.

## ChatGPT verwenden (optional)

In den Einstellungen im Anbieter-Schalter `ChatGPT` wählen und `Continue with ChatGPT` wählen; derselbe Button verbindet später neu. Nach einer kurzen Erklärung öffnet sich die offizielle OpenAI-Anmeldung im Standardbrowser. Dort anmelden und die Plannutzung freigeben, danach zur App zurückwechseln. Die Wahl des Anbieters wird gemerkt. Solange ChatGPT genutzt wird, steht unter dem Arbeitsbereich der von OpenAI vorgeschriebene Hinweis „ChatGPT-Plan · Nutzung“.

Tokens liegen nur im Arbeitsspeicher der laufenden App und werden beim Beenden verworfen; nach etwa einer Stunde ist eine neue Anmeldung nötig. Gespeichert werden nur eine Host-ID, die Registrierungskennung und die bestätigte Konto-ID, in der Desktop-App unter `~/Library/Application Support/Transcrilator/runtime`. Die zugrunde liegende OpenAI-Funktion ist eine [Preview](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations); Verfügbarkeit und Limits bestimmt OpenAI.

## Bedienung

- Text im Tab `Englisch` einfügen, `Übersetzen` oder Cmd+Enter. Das Eingabefeld ist eine mittige Karte. Leer zeigt sie mittig „Transkript einfügen“; zeigt man mit der Maus darauf oder klickt hinein, verwandelt sich der Hinweis in „Drücke ⌘ V“. Geschrieben und eingefügt wird oben links, langer Text scrollt innerhalb der Karte.
- Während der Übersetzung erzählen wechselnde kleine Sätze mit passender Animation, was gerade mit dem Skript passiert; Balken und bei langen Texten „x von y Teilen fertig“ zeigen den echten Fortschritt. Der Ladezustand endet genau dann, wenn die Übersetzung fertig ist.
- Erst wenn die Übersetzung vollständig ist, wechselt die Ansicht auf `Deutsch` und der Text wird automatisch in die Zwischenablage kopiert (kurzer Hinweis „In die Zwischenablage kopiert“). In der Desktop-App klappt das auch, wenn das Fenster inzwischen im Hintergrund ist. Blockiert ein Browser das automatische Kopieren, übernimmt der Button `Kopieren` das. Kopiert wird mit Formatierung (fett/kursiv) für Programme, die das unterstützen, sonst als reiner Text ohne Sternchen.
- `Clear` leert beide Seiten. Während der Übersetzung bricht der Button ab.
- Der Übersetzungsprompt liegt unter Einstellungen → Prompt. Das Stift-Symbol schaltet die Bearbeitung frei, `Zurücksetzen` stellt den Standard wieder her.

## Mehrere Skripte und Videos (Tabs)

- Neuer Tab mit ⌘ T oder dem kleinen + rechts neben der Karte; zwischen Tabs wechseln mit ⌘ ← / ⌘ →. Gibt es auf der Seite noch keinen Tab, entsteht er dort.
- Unter der Karte erscheinen Punkte, sobald es mehr als einen Tab gibt: grau gefüllt ist der aktive Tab, ein grauer Ring ein anderer. Ein Klick springt dorthin, beim Zeigen erscheint der Titel.
- Leere Tabs räumen sich selbst auf, sobald man sie verlässt.
- Mehrere Videos auf einmal in die Karte ziehen oder mit ⌘ O auswählen: Jedes bekommt einen Tab, sie werden nacheinander im Hintergrund transkribiert und übersetzt. Ein wartender Tab zeigt das an.
- Mit einem Tab wird wie gewohnt automatisch kopiert; bei mehreren Tabs meldet ein kurzer Hinweis „Tab 2 fertig“, kopiert wird pro Tab mit ⌘ C oder `Kopieren`.
- `Clear` (⌘ ⌫) bringt die App in den Ausgangszustand: eine leere Karte. Läuft noch etwas, fragt sie vorher. Fertige Übersetzungen stehen im Verlauf.
- Das Video selbst wird nach der Transkription nicht aufbewahrt, nur sein Transkript.

## Copywriting Board (Shortform und Ads)

Ist ein Skript kürzer als 3 Minuten (Shortform), kopiert die App es im Format des Studyacademy Copywriting Boards: eine Szene pro Zeile, die Hook zuerst, das Skript direkt dahinter, ohne Formatierungszeichen. In Google Sheets oder Excel in die letzte Hook-Zeile der Spalte „Voice Over“ klicken (zum Beispiel C15) und ⌘ V drücken; jede Szene landet in ihrer eigenen Zeile, die verbundenen Zellen und das Zellformat bleiben erhalten. Die beiden Hook-Zeilen darüber bleiben für Ad-Hook-Varianten frei. Längeres (Longform, ab 3 Minuten) wird als normaler Text mit Absätzen kopiert.

So wird die Länge bestimmt:
- transkribiertes Video: echte Länge der Tonspur
- eingefügtes Transkript mit Zeitstempeln (z. B. YouTube „4:12“): letzter Zeitstempel
- reiner Text: Schätzung mit 150 gesprochenen Wörtern pro Minute; liegt sie zwischen 2 und 4 Minuten, fragt die App vor dem Übersetzen einmal „Shortform oder Longform?“

Unter den Buttons steht nach der Übersetzung das erkannte Format; „Als Longform/Shortform kopieren“ stellt es um und kopiert neu.

## Verlauf

In den Einstellungen unter „Verlauf“ stehen die letzten 30 Übersetzungen mit Datum, Format und Länge. Ein Klick kopiert sie erneut im passenden Format. Gespeichert werden nur die deutsche Übersetzung, ein kurzer Titel und die Länge, ausschließlich lokal auf dem Rechner; „Verlauf löschen“ entfernt alles.

## Video lokal transkribieren

Ein heruntergeladenes Video oder eine Audiodatei (MP4, MOV, M4A, MP3, WAV, WebM) in die Karte ziehen oder mit ⌘ O auswählen. Die App liest die Tonspur aus, Whisper (`onnx-community/whisper-small.en`, englisch) erstellt daraus lokal das englische Transkript, und danach übersetzt der gewählte Anbieter automatisch ins Deutsche.

- Ton und Transkript bleiben auf dem Rechner. Nur das Modell (rund 410 MB) wird beim ersten Mal einmalig von Hugging Face geladen und danach aus dem Cache verwendet.
- Auf Macs mit Apple Silicon läuft Whisper über WebGPU auf der Grafikeinheit; ohne WebGPU auf der CPU (langsamer).
- Die nötigen Bibliotheken liegen unverändert unter `public/vendor/` (transformers.js, Apache-2.0; ONNX Runtime Web, MIT) und werden nie von einem CDN geladen.

## Kurzbefehle

| Aktion | Mac |
|---|---|
| Übersetzen bzw. Kopieren (Hauptaktion) | ⌘ ↩ |
| Video oder Audio lokal transkribieren | ⌘ O |
| Neuer Tab | ⌘ T |
| Zwischen Tabs wechseln | ⌘ ← / ⌘ → |
| Text einfügen, ohne vorher ins Feld zu klicken | ⌘ V |
| Fertige Übersetzung kopieren | ⌘ C |
| Zwischen Englisch und Deutsch wechseln | ⇧ ⇥ (auch ⌃ ⇥ oder ⌘ ⇧ [ / ]) |
| Alles leeren (Clear) | ⌘ ⌫ |
| Einstellungen öffnen | ⌘ , |

⌘ Tab gehört macOS für den Programmwechsel und kann von keiner App genutzt werden. Die Übersicht steht auch in den Einstellungen hinter dem ⌘-Symbol; beim kurzen Zeigen mit der Maus erscheint der jeweilige Kurzbefehl klein unter dem Element. Unter Windows und Linux gilt Strg statt ⌘. In den Einstellungen und Dialogen behält ⇧ ⇥ seine übliche Rolle (zum vorherigen Element springen). In der Browser-Variante kann der Browser einzelne Kurzbefehle wie ⌃ ⇥ selbst belegen.

## Grenzen und Verlässlichkeit

- Bis zu 500.000 Zeichen pro Übersetzung. Nichts wird still abgeschnitten.
- Texte werden verlustfrei in Teile von höchstens 6.000 Zeichen zerlegt, bevorzugt an Absatz- oder Satzgrenzen. Claude übersetzt bis zu drei Teile gleichzeitig, ChatGPT nacheinander. Die Teile werden in Originalreihenfolge zusammengesetzt.
- Scheitert ein Teil (Limit, Timeout von 180 Sekunden, Abbruch, unvollständige Antwort), wird die gesamte Übersetzung verworfen. Ein Teilergebnis wird nie als fertig angezeigt.
- Diese Prüfungen sichern Vollständigkeit und Reihenfolge der Übertragung. Ob ein Sprachmodell jede Nuance richtig übersetzt, muss am Ergebnis geprüft werden.

## Browser-Variante und Entwicklung

Für die Desktop-App ist nichts weiter nötig: Electron und alles andere stecken bereits in der App. Nur wer die App aus dem Quellcode startet oder baut, braucht Node.js 24 oder neuer.

```sh
npm start
```

Dann http://127.0.0.1:4317 öffnen (anderer Port: `PORT=4319 npm start`). Auf dem Mac geht auch ein Doppelklick auf `Start.command`. Der Server bindet ausschließlich an 127.0.0.1, prüft Host, Origin und ein CSRF-Token und ist nicht aus dem Netzwerk erreichbar. Der Server selbst hat keine Paketabhängigkeiten.

Desktop-App lokal starten und bauen (benötigt `npm install` für Electron und electron-builder):

```sh
npm install
npm run desktop     # App aus dem Quellcode starten
npm run dist:mac    # DMG und ZIP für arm64 und x64 nach dist/
```

Tests:

```sh
npm run check
npm test
```

Die Tests decken OAuth/JWKS-Prüfung, Origin/CSRF/Host, verlustfreies Chunking, Stream-Abschlüsse, Abbruch und Fehler, den exakten Standardprompt sowie den isolierten Claude-Adapter ab (inklusive paralleler Teile). Sie verwenden nur synthetische Antworten.

## Wie die Claude-Anbindung arbeitet

Pro Textteil startet die App das unveränderte `claude`-Programm ohne Shell in einem leeren temporären Ordner, mit `--safe-mode`, ohne Tools und MCP-Server, ohne Sitzungsspeicherung und mit dem Prompt als Systemprompt. Der Quelltext geht über stdin. Vorher prüft sie die unterstützten Sicherheitsoptionen und mit `claude auth status`, dass eine Abo-Anmeldung vorliegt. Nur eine vollständige, erfolgreiche JSON-Antwort wird übernommen.

Die App bringt Claude Code nicht mit und bietet keinen eigenen Claude-Login an. Das entspricht den Vorgaben in Anthropics [Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance): Endnutzer melden sich selbst im unveränderten Claude Code mit ihrem eigenen Abo an. Transcrilator ist ein unabhängiges Projekt und nicht von Anthropic oder OpenAI.

## Offizielle Quellen

- Claude Code: [CLI-Referenz](https://code.claude.com/docs/en/cli-reference), [Headless](https://code.claude.com/docs/en/headless), [Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance), [Claude-Plan mit Agent SDK](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- OpenAI: [Überblick](https://developers.openai.com/siwc/token-sharing-open-source), [Anmeldung](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Modelle und Inferenz](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Tokenreferenz](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [Preview-Grenzen](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [UI-Hinweise](https://developers.openai.com/siwc/ui-ux-guidelines)

OAuth nutzt Authorization Code mit PKCE, dynamische Registrierung beim ersten Mal, stabile Host-ID, state/nonce und RS256-ID-Token-Prüfung per offizieller JWKS. Callback: `http://127.0.0.1:<Port>/auth/callback`. Inferenz läuft über `https://api.openai.com/v1/responses` mit `store:false` und `stream:true`.
