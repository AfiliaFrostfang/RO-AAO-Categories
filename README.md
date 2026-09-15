# RO-AAO-Categories
QoL Skript für Rescue Operator das die AAOs in Kategorien einteilen lässt

Es:

- erkennt vorhandene AAOs im Spiel,
- lässt User sie in eigene Kategorien wie Brandbekämpfung, Technische Hilfe und Rettungsdienst sortieren,
- speichert Kategorien und Zuordnungen lokal im Browser über IndexedDB,
- ersetzt die AAO-Auswahl im Alarmierungsfenster durch eine kategorisierte Ansicht,
- ermöglicht Suche, Ein-/Ausblenden, Bearbeiten und Löschen von AAOs,
- ermöglicht das individuelle Verschieben und Sortieren der Kategorien,
- prüft beim Start die `version.json` auf GitHub Pages und weist auf Updates hin,
- synchronisiert die Anzeige automatisch mit Änderungen im Spiel.

Für eine neue Version müssen `@version` und `SCRIPT_VERSION` in `AAOCategories.user.js`
sowie `version` in `version.json` aktualisiert werden. Die Datei `version.json` muss
über GitHub Pages unter `https://afiliafrostfang.github.io/RO-AAO-Categories/version.json`
erreichbar sein.

TLDR: Es erweitert nur die lokale AAO-Verwaltung und Fahrzeug-Alarmierung.

Dieses Tool benutzt keine Automatisierungswerkzeuge oder andere durch die AGB und Regeln verbotene Funktionen, es erweitert nur die AAO Funktionen durch Kategorieren im Einstellungs und Dispatch Fenster.
Der Quellcode wird hier immer sichtbar und einsehbar sein und kann jederzeit durch die Administration geprüft und genehmigt oder abgelehnt werden.
