# IAI Bonus Manager 🚀

Skrypt automatyzujący zliczanie ticketów i monitorowanie celu dziennego.

## Instalacja

1. Zainstaluj dodatek [Tampermonkey](https://www.tampermonkey.net/).
2. [Kliknij tutaj, aby zainstalować skrypt](https://raw.githubusercontent.com/dizzeeyy/iai-bonus/main/bonus-manager.user.js).
3. Kliknij **Zainstaluj**.

## Konfiguracja

Przy pierwszym uruchomieniu zostaniesz poproszony o podanie:

- Imienia i Nazwiska (jak w systemie)
- Celu dziennego

## Działanie

Skrypt automatycznie zlicza komunikaty, na które w danym dniu została udzielona odpowiedź:

- jeśli komunikat był na liście i go zamknęliście, po odświeżeniu listy komunikatów bonus manager automatycznie wykryje ilość komunikatów zamkniętych oraz doda je do JSON, dzięki któremu weryfikuje to, czy komunikat był już realizowany,
- notatka po rozmowie: po zamknięciu rozmowy i utworzeniu notatki, pozostańcie na niej z 2-3 sekundy, dopóki przeglądarka nie wyświetli powiadomienia, skrypt automatycznie dodaje notatki z rozmowy do listy zrealizowanych celów.

## Funkcjonalności

1. Skanuj: rozpoczyna skanowanie pliku JSON i listy komunikatów - przydatne po zamknięciu notatki z rozmowy - natychmiast jest ona uwzględniana w UI skryptu.
2. JSON: eksportuje całą historię odpowiedzi na komunikaty oraz ilości zrealizowanych celów. Warto robić raz dziennie co najmniej.
3. Import: gdyby były problemy z danymi, to można wyeksportowany plik JSON edytować zgodnie ze schematem, a następnie zaimportować - dane zostaną odświeżone.
4. Ustawienia: imię i nazwisko trzeba podać tak jak jest w iai-system, bez spacji na końcu i początku, zachowując wielkość liter. Cel dla skryptu polecam ustawić na drugi próg - większa motywacja :D

## Feedback

Wszelki feedback mile widziany, większość funkcji została przetestowana, ale jak znajdziecie błędy, to śmiało piszcie na Teams.
