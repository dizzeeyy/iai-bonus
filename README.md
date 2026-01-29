# IAI Bonus Manager 🚀

Skrypt automatyzujący zliczanie ticketów i monitorowanie celu dziennego.

# Instalacja

1. Zainstaluj dodatek [Tampermonkey](https://www.tampermonkey.net/).
2. Wykonaj instrukcje od Tampermonkey, **inaczej skrypty się nie uruchomią**: [instrukcja](https://www.tampermonkey.net/faq.php?locale=en#Q209)
3. [Kliknij tutaj, aby zainstalować skrypt](https://raw.githubusercontent.com/dizzeeyy/iai-bonus/main/bonus-manager.user.js).
4. Kliknij **Zainstaluj**.

# Konfiguracja

Przy pierwszym uruchomieniu zostaniesz poproszony o podanie:

- Imienia i Nazwiska **(jak w systemie)**
- Celu dziennego

# Działanie

## Skrypt automatycznie zlicza komunikaty, na które w danym dniu została udzielona odpowiedź:

- jeśli komunikat był na liście i go zamknęliście, po odświeżeniu listy komunikatów bonus manager automatycznie wykryje ilość komunikatów zamkniętych oraz doda je do JSON, dzięki któremu weryfikuje to, czy komunikat był już realizowany,
- notatka po rozmowie: po zamknięciu rozmowy i utworzeniu notatki, pozostańcie na niej z 2-3 sekundy, dopóki przeglądarka nie wyświetli powiadomienia, skrypt automatycznie dodaje notatki z rozmowy do listy zrealizowanych celów.

## Dodatkowe scenariusze

Gdyby były jeszcze jakieś scenariusze poza tymi, które są wymienione, to dajcie znać.

Aktualnie obsługiwane wyjątki w logice:

- jeśli komunikat został zabrany przez kogoś innego z Twojej listy, nie zalicza, bo ostatnią osobą w komunikacie podczas przenoszenia nie jesteś Ty,
- skrypt nie zlicza komunikatów, które są: _Escalation_, _Improvement_, _New feature suggestion_, _Internal support_,
- **zespół _Aplikacji pomocniczych_ nie pracuje na rozdzielniku, ale to w teorii też powinno zostać obsłużone**, czyli zabierając ticket z rozdzielnika z pierwszą wiadomością do klienta powienien on zostać od razu oznaczony jako wykonany, pod warunkiem, że przechodzi przez Waszą listę. **Zamknięcie ticketu z rozdzielnika na siebie nie zaliczy się do postępu,**
- rozbicie komunikatu, czyli wydzielenie komunikatu na siebie, bez jeszcze wiadomości od klienta też zadziała, bo jest to komunikat z Twoją ostatnią odpowiedzią.

**_Na pewno nie jest obsługiwany scenariusz, w którym: odpowiesz klientowi na ticket, nie odświeżysz listy ticketów i ticket nie zostanie automatycznie zaliczony, a klient w międzyczasie Ci odpowie._**
Dlaczego?
**Ticket najpierw musi być wpisany do "bazy" i pliku JSON, a jest on wpisywany automatycznie po odświeżeniu listy ticketów, jeśli zniknął i to była Twoja odpowiedź.**
Zatem jeśli ticket zniknie nawet z Twoją odpowiedzią, ale nie odświeżysz lity, a komunikat zdąży wrócić od klienta - no to klops. Ale zawsze możesz ręcznie edytować JSON i ten ticket tam wpisać.

# Funkcjonalności

1. **Skanuj**: rozpoczyna skanowanie pliku JSON i listy komunikatów - przydatne po zamknięciu notatki z rozmowy - natychmiast jest ona uwzględniana w UI skryptu.
2. **JSON**: eksportuje całą historię odpowiedzi na komunikaty oraz ilości zrealizowanych celów. Warto robić raz dziennie co najmniej.
3. **Import**: gdyby były problemy z danymi, to można wyeksportowany plik JSON edytować zgodnie ze schematem, a następnie zaimportować - dane zostaną odświeżone.
4. **Ustawienia**: imię i nazwisko trzeba podać tak jak jest w iai-system, bez spacji na końcu i początku, zachowując wielkość liter. Cel dla skryptu polecam ustawić na drugi próg - większa motywacja :D
5. Licznik komunikatów automatycznie zeruje się codziennie

# Feedback

Wszelki feedback mile widziany, większość funkcji została przetestowana, ale jak znajdziecie błędy, to śmiało piszcie na Teams.
