# Lokaler Englisch-Deutsch-Übersetzer

Eigenständige lokale Browser-App, MIT-lizenziert. Node.js 24 oder neuer wird benötigt. Es gibt keine Paketabhängigkeiten, keinen eigenen App-Login und keine API-Key-Eingabe.

## Starten und stoppen

Auf dem Mac `Start.command` doppelklicken oder im Projektordner:

```sh
npm start
```

Dann http://127.0.0.1:4317 öffnen. Stoppen mit Ctrl+C im zugehörigen Terminal. Ein anderer Port ist mit `PORT=4319 npm start` möglich; auch dann bindet der Server ausschließlich 127.0.0.1. Der Server ist keine öffentliche Website und bietet keine LAN-Freigabe. Zum Transport das ZIP entpacken und mit lokal vorhandenem Node starten. Das Paket enthält keine Node-Laufzeit.

## ChatGPT verbinden

`Einstellungen` mittig über dem Sprachschalter öffnen und `Continue with ChatGPT` wählen. Das öffnet zuerst eine lokale Erklärung. Erst `Anmeldung öffnen` startet die offizielle OpenAI-OAuth-Anmeldung in einem separaten Fenster, damit Eingabe und Prompt im ursprünglichen Fenster erhalten bleiben. Pop-ups für die lokale Seite müssen dafür erlaubt sein. Persönlich bei OpenAI anmelden und die angefragte Plannutzung dort prüfen und freigeben. Passwörter gehören ausschließlich in die offizielle Anmeldung. Danach das Anmeldefenster schließen, zum Übersetzer zurückkehren und die erstmalige Plannutzungsanzeige bestätigen. Erst dann lässt sich übersetzen.

Jede Person verbindet ihr eigenes ChatGPT-Konto auf ihrem Rechner. Keine vorhandenen Codex- oder Browser-Credentials werden gelesen. Die App erzeugt keinen kostenpflichtigen API-Key und weicht nicht auf fremde API-Konten aus. Modellwahl stammt aus dem offiziellen, kontospezifischen Modellkatalog. Die tatsächliche Verfügbarkeit und Plannutzung hängen von OpenAIs Freigabe und den Kontolimits ab.

Tokens werden nur im Arbeitsspeicher des lokalen Node-Prozesses gehalten. Weder Frontend noch localStorage, Dateien oder Logs erhalten Tokens. Beim Server-Stopp oder Trennen werden sie verworfen. Ein eventuell ausgestelltes Refresh-Token wird nicht gespeichert oder verwendet. Nach Ablauf des Access-Tokens (laut Dokumentation etwa eine Stunde) ist eine erneute, vom Nutzer gestartete Anmeldung erforderlich. Es gibt keine automatische neue Berechtigungsanforderung und keine dauerhafte Token-Speicherung.

`.runtime/host.json` enthält nur eine stabile Host-UUID, die ausgestellte Client-ID, die validierte Konto-ID und die Erstverbindungsbestätigung, mit Dateirechten 0600 in Verzeichnis 0700. Diese Metadaten ermöglichen Wiederanmeldung mit der bestehenden Registrierung. Sie werden nicht im portablen ZIP mitgeliefert. Auf einem anderen Rechner wird eine neue Host-ID angelegt. Quelltext und Übersetzung bleiben im geöffneten Tab. Eigene Prompts werden im Browser-Sitzungsspeicher erhalten; OAuth-Tokens gelangen dort niemals hin. Für Übersetzungen sendet die App den Quelltext und Prompt an OpenAI.

## Bedienung und Grenzen

Im mittigen Sprachschalter `Englisch` wählen, Text einfügen und `Übersetzen` oder Cmd/Ctrl+Enter drücken. Nach vollständigem Abschluss wechselt die einzelne Textansicht automatisch auf `Deutsch`; derselbe Hauptbutton heißt dann `Kopieren` und übernimmt ausschließlich die fertige deutsche Ausgabe. Der Sprachschalter erhält beide Texte beim Wechsel. `Clear` leert beide Texte und führt zurück zu Englisch. Während einer Anfrage heißt der Hauptbutton `Abbrechen`. Verbindung, Modell, Prompt und Zeichenanzahl sind im Einstellungsmenü untergebracht; der Prompt bleibt dort zusätzlich zugeklappt. Der vorgeschriebene kleine ChatGPT-Planhinweis bleibt neben dem Arbeitsbereich sichtbar. Neue Eingaben oder Prompt-Änderungen verwerfen veraltete Ausgaben.

Der Standardprompt verlangt vollständige Inhaltstreue und Reihenfolge des gesprochenen Textes. Eindeutig nichtsprachliche Transkriptmarker wie `[Musik]` und `[Music]` werden entfernt. Kürzere, klare Absätze folgen natürlichen Sprechpausen, neuen Gedanken und sprachlichen Übergängen; zwischen Absätzen steht eine Leerzeile. Inhaltlich relevante Angaben in Klammern bleiben erhalten. Es werden keine zusätzlichen Überschriften oder Erläuterungen angefordert; vorhandene Überschriften werden fett und wertvolle Konzepte kursiv dargestellt. Der exakt vorgegebene Standardprompt ist zuerst nur lesbar; das Stift-Icon schaltet die Bearbeitung frei. Zurücksetzen stellt den Standard wieder her. Kopieren liefert vollständigen Plaintext ohne Markdown-Sterne und zusätzlich sichere Formatierung für kompatible Zielprogramme. Anweisungen innerhalb des Quelltexts sind Übersetzungsinhalt.

Die technische Grenze ist 500.000 UTF-16-Zeichen pro Übersetzung. Es wird nichts still abgeschnitten. Texte werden verlustfrei in Teile von höchstens 6.000 Zeichen zerlegt, bevorzugt an Absatz-, Satz- oder Wortgrenzen. Bei einem einzigen sehr langen Wort ist eine harte Teilung nötig; UTF-16-Surrogatpaare bleiben zusammen. Die Teile werden nacheinander verarbeitet und in gleicher Reihenfolge mit Leerzeilen zusammengesetzt.

Jeder Teil muss ein `response.completed` mit abgeschlossenem Status und nicht leerer Textausgabe liefern. Wenn das Abschlussereignis den vollständigen Text enthält, ist dieser maßgeblich. Andernfalls werden bestätigte `output_text.done`-Texte oder die bis zum erfolgreichen Abschluss empfangenen Text-Deltas verwendet. Eine exakte Gleichheit von Deltas und Abschluss-Snapshot ist keine zusätzliche Erfolgsbedingung. Ein Abbruch, Refusal, Timeout (180 Sekunden pro Teil), Modellfehler oder Nutzungslimit verwirft die gesamte Ausgabe. Kein Teilresultat wird als fertige Übersetzung angezeigt oder zum Kopieren freigegeben. Es gibt keine automatischen Inferenzwiederholungen. Eine Teilantwort über 200.000 Zeichen und ein einzelnes Stream-Ereignis über 1 MB werden ausdrücklich abgelehnt.

Diese Prüfungen sichern die vollständige Übertragung und Reihenfolge aller Teile. Sie können nicht beweisen, dass ein Sprachmodell innerhalb eines Teils jede Nuance korrekt übersetzt hat. Änderungen des Prompts und harte Teilgrenzen können die sprachliche Qualität beeinflussen. Inhaltstreue muss am echten Ergebnis gegen den Quelltext geprüft werden.

## Tests und Plattformen

```sh
npm run check
npm test
```

59 automatisierte Tests bestehen: OAuth/JWKS, Origin/CSRF/Host, verlustfreies Chunking, vollständige Streamabschlüsse, Abbruch/Fehler, exakter Standardprompt und isolierter Claude-CLI-Adapter. Browsergeprüft: Desktop sowie 320/375 Pixel Breite, Prompt lesen/bearbeiten/zurücksetzen, Wechsel Englisch/Deutsch, Clear, Abbruch, sichere Fett-/Kursivdarstellung und vollständiges Plaintext-Kopieren. Modell-HTML wird nur als Text dargestellt. Der leere Platzhalter ist zentriert; eingegebener Text bleibt linksbündig. Die Animation respektiert reduzierte Bewegung.

Getestet auf diesem Mac mit Node 24.14.0. Windows und Linux sind nicht praktisch getestet. Dort ist `npm start` als Startweg vorgesehen; `Start.command` ist ausschließlich für macOS. Keine Node-Laufzeit, keine Claude-Binary und keine Desktop-App sind enthalten.

Die private optionale Benutzerdatei und lokale Testberichte sind nicht im ZIP. Ohne diese Datei überspringt die Testsuite den zusätzlichen Dateitest. Frühere echte ChatGPT-Kurz- und Langtexttests waren technisch erfolgreich; sprachliche Abweichungen bei Anrede, Einheiten und Namen wurden gefunden. Die jüngste Prompt-/UI-Version wurde mit synthetischen Antworten geprüft, nicht erneut live übersetzt.

## Claude vorbereiten

Claude ist als zweite Auswahl ausschließlich im Einstellungsmenü vorbereitet. Benötigt wird separat installiertes unverändertes Claude Code mit geeigneter persönlicher Claude-Plan-Anmeldung. Die App installiert nichts, öffnet keinen eigenen Claude-OAuth-Dialog und liest keine Token-Dateien. Persönliche Anmeldung erfolgt im offiziellen CLI über `claude auth login`. Kein API-Key-Fallback und kein fremdes Konto werden verwendet.

Vor jedem Aufruf prüft die App die verfügbaren Sicherheitsoptionen und den nativen Anmeldestatus. Nur `claude.ai` wird akzeptiert. Quelle gelangt über stdin an einen Subprozess ohne Shell, mit leerem temporärem Arbeitsordner, deaktivierten Tools/MCP, Safe Mode und ohne Sitzungsspeicherung. Kostenrelevante API-/Cloud-Umgebungsvariablen werden nicht weitergereicht. Nur eine erfolgreiche vollständige JSON-Antwort wird übernommen.

Lokaler Prüfstand: Claude Code 2.1.270 vorhanden. Ein kurzer Liveversuch lieferte keine bestätigte vollständige Antwort; die anschließende Statusprüfung meldete keine Anmeldung. Claude-Liveinferenz ist daher nicht erfolgreich verifiziert. Mocktests bestehen. Der bereits laufende ältere Server wurde für die UI nicht neu gestartet; der neue Adapter wird beim nächsten bewussten Serverstart aktiv. Ein Neustart verwirft die ChatGPT-RAM-Sitzung.

## Weitergabe und Desktop

Das portable ZIP enthält Quellcode, synthetische Tests, README, Lizenz und Mac-Startskript. Ausgeschlossen sind `.runtime`, persönliche OAuth-Registrierung, Benutzertexte/-ausgaben, Logs, private Prüfberichte und fremde Binärdateien. Jede Person startet lokal und verwendet ihr eigenes Konto. Das ZIP ist kein eigenständig installiertes Desktop-Programm und wird nicht automatisch an ein Team versendet.

Für eine spätere Mini-Desktop-App passt ein dünner Electron-Wrapper zum vorhandenen Node-Server. Noch keine `.app` oder `.exe` gebaut, signiert oder auf anderen Plattformen geprüft. Claude Code weiterhin separat installieren; vor Distribution sind die jeweiligen Commercial Terms zu prüfen.

## Offizielle Quellen

Am 22.10.2026 erneut geprüft:

- [Überblick](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registrierung und Anmeldung](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Modelle und Inferenz](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Tokenreferenz](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Preview-Grenzen](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Vorgeschriebene UI-Hinweise](https://developers.openai.com/siwc/ui-ux-guidelines)

OAuth nutzt Authorization Code mit PKCE, dynamische Registrierung nur beim ersten Mal, stabile Host-ID, state/nonce und RS256-ID-Token-Prüfung per offizieller JWKS. Exakter Loopback-Callback: `http://127.0.0.1:<Port>/auth/callback`. Token-Austausch verwendet die ausgestellte Client-ID. Inferenz läuft über `https://api.openai.com/v1/responses`, mit `store:false`, `stream:true` und ohne nicht unterstützte Preview-Felder.


Claude-Quellen: [CLI-Referenz](https://code.claude.com/docs/en/cli-reference), [Headless](https://code.claude.com/docs/en/headless), [Legal](https://code.claude.com/docs/en/legal-and-compliance), [Claude-Plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
