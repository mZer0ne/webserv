# WebServ

Modern cross-platform desktop application for local web development.

## Description

WebServ is a desktop application designed to simplify local web development by providing a modern, cross-platform solution. It leverages Electron to deliver a native desktop experience, React for a dynamic user interface, and integrates with Docker via `dockerode` to manage local web development environments. This tool aims to streamline the setup and management of various web services and projects on your local machine.

## Features

*   **Cross-platform**: Available on Windows, macOS, and Linux.
*   **Local Web Development Environment Management**: Easily manage your web projects and services.
*   **Docker Integration**: Utilize Docker containers for isolated and consistent development environments.
*   **Modern UI**: Built with React for a responsive and intuitive user experience.
*   **Configuration Management**: Uses `electron-store` and `yaml` for persistent application settings.

## Technologies Used

*   **Electron**: For building cross-platform desktop applications.
*   **React**: A JavaScript library for building user interfaces.
*   **TypeScript**: A typed superset of JavaScript that compiles to plain JavaScript.
*   **Vite**: A fast build tool for modern web projects.
*   **Dockerode**: A Node.js module for interacting with the Docker daemon.
*   **Axios**: Promise-based HTTP client for the browser and Node.js.
*   **Electron Log**: Simple logging module for Electron.
*   **Electron Store**: Save and load data like a pro.
*   **YAML**: For parsing and stringifying YAML.

## Installation

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm (comes with Node.js)
*   Docker Desktop (or Docker Engine) installed and running

### Steps

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/mZer0ne/WebServ.git
    cd WebServ
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Usage

### Development Mode

To run the application in development mode:

```bash
npm run dev
npm run electron:dev
```

This will start the Vite development server and then launch the Electron application, allowing for hot-reloading and easier debugging.

### Building for Production

To build the application for your specific operating system:

*   **For Windows (64-bit):**
    ```bash
    npm run electron:win
    ```
*   **For macOS (ARM64):**
    ```bash
    npm run electron:mac
    ```

The build output will be located in the `release` directory.

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Author

mZer0ne
