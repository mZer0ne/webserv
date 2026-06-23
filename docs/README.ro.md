# WebServ

Aplicație desktop modernă, multiplatformă, pentru dezvoltare web locală.

## Descriere

WebServ este o aplicație desktop concepută pentru a simplifica dezvoltarea web locală, oferind o soluție modernă, multiplatformă. Utilizează Electron pentru a oferi o experiență desktop nativă, React pentru o interfață de utilizator dinamică și se integrează cu Docker prin `dockerode` pentru a gestiona mediile de dezvoltare web locale. Acest instrument își propune să eficientizeze configurarea și gestionarea diferitelor servicii și proiecte web pe mașina dvs. locală.

## Funcționalități

*   **Multiplatformă**: Disponibilă pe Windows, macOS și Linux.
*   **Gestionarea mediului de dezvoltare web local**: Gestionați cu ușurință proiectele și serviciile dvs. web.
*   **Integrare Docker**: Utilizați containere Docker pentru medii de dezvoltare izolate și consistente.
*   **Interfață de utilizator modernă**: Construită cu React pentru o experiență de utilizare receptivă și intuitivă.
*   **Gestionarea configurației**: Utilizează `electron-store` și `yaml` pentru setările persistente ale aplicației.

## Tehnologii utilizate

*   **Electron**: Pentru construirea aplicațiilor desktop multiplatformă.
*   **React**: O bibliotecă JavaScript pentru construirea interfețelor de utilizator.
*   **TypeScript**: Un superset tipizat al JavaScript-ului care compilează în JavaScript simplu.
*   **Vite**: Un instrument rapid de construire pentru proiecte web moderne.
*   **Dockerode**: Un modul Node.js pentru interacțiunea cu daemonul Docker.
*   **Axios**: Client HTTP bazat pe promisiuni pentru browser și Node.js.
*   **Electron Log**: Modul simplu de logare pentru Electron.
*   **Electron Store**: Salvați și încărcați date ca un profesionist.
*   **YAML**: Pentru parsarea și serializarea YAML.

## Instalare

Pentru a obține o copie locală și a o rula, urmați acești pași simpli.

### Precondiții

*   Node.js (se recomandă versiunea LTS)
*   npm (vine cu Node.js)
*   Docker Desktop (sau Docker Engine) instalat și rulat

### Pași

1.  **Clonați depozitul:**
    ```bash
    git clone https://github.com/mZer0ne/WebServ.git
    cd WebServ
    ```
2.  **Instalați dependențele:**
    ```bash
    npm install
    ```

## Utilizare

### Modul de dezvoltare

Pentru a rula aplicația în modul de dezvoltare:

```bash
npm run dev
npm run electron:dev
```

Acest lucru va porni serverul de dezvoltare Vite și apoi va lansa aplicația Electron, permițând reîncărcarea la cald și o depanare mai ușoară.

### Construirea pentru producție

Pentru a construi aplicația pentru sistemul dvs. de operare specific:

*   **Pentru Windows (64-bit):**
    ```bash
    npm run electron:win
    ```
*   **Pentru macOS (ARM64):**
    ```bash
    npm run electron:mac
    ```

Rezultatul construirii va fi localizat în directorul `release`.

## Contribuții

Contribuțiile sunt ceea ce face ca comunitatea open source să fie un loc atât de uimitor pentru a învăța, a inspira și a crea. Orice contribuție pe care o faceți este **foarte apreciată**.

1.  Fork-ați proiectul
2.  Creați-vă ramura de funcționalitate (`git checkout -b feature/AmazingFeature`)
3.  Comiteți modificările (`git commit -m 'Add some AmazingFeature'`)
4.  Împingeți în ramură (`git push origin feature/AmazingFeature`)
5.  Deschideți o cerere de extragere

## Licență

Distribuit sub licența MIT. Consultați `LICENSE` pentru mai multe informații.

## Autor

mZer0ne
