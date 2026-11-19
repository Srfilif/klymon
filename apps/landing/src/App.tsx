import { useEffect, useState } from 'react';
import { checkApiStatus, docsUrl, releasesUrl, repoUrl, type ApiStatus } from './lib/api';

const FEATURES: Array<{ title: string; body: string }> = [
  { title: 'Launcher moderno', body: 'Instancias, versiones, modloaders (Fabric, Quilt, Forge, NeoForge), Java gestionado y diagnóstico de crashes con pistas accionables.' },
  { title: 'Cliente integrado', body: 'Mod Fabric con 22 addons de HUD y PvP, editor visual, perfiles y cosméticos locales. Funciona sin conexión.' },
  { title: 'Mods y contenido', body: 'Explora e instala desde Modrinth y CurseForge, importa archivos .jar/.zip y exporta modpacks .mrpack.' },
  { title: 'Skins y música', body: 'Visor 3D de skins con subida a Mojang, y reproductor de música local con playlists.' },
  { title: 'Progresión local', body: 'Niveles, misiones diarias, logros y tienda de cosméticos con moneda virtual. Tus datos se quedan en tu equipo.' },
  { title: 'Cuenta Klymon (API)', body: 'Registro, sesiones y sincronización en camino sobre la API central. El escritorio sigue siendo offline-first.' },
];

const FAQS: Array<{ q: string; a: string }> = [
  { q: '¿Necesito cuenta de Microsoft?', a: 'Solo para jugar online en servidores premium. Klymon también soporta perfiles offline para un jugador y pruebas locales.' },
  { q: '¿Qué Java necesito?', a: 'Ninguno instalado a mano: el launcher descarga el runtime oficial de Mojang según tu versión de Minecraft.' },
  { q: '¿Funciona sin internet?', a: 'El juego y el cliente sí, una vez instalado todo. La API de cuentas es opcional y nunca bloquea el juego.' },
  { q: '¿Dónde reporto un error?', a: 'En los Issues del repositorio de GitHub, con el bloque de diagnóstico que copia el diálogo de crash.' },
];

function StatusPill({ status }: { status: ApiStatus }): React.JSX.Element {
  const label = status === 'checking' ? 'Comprobando API…' : status === 'online' ? 'API en línea' : 'API local no detectada';
  return (
    <span className={`pill pill-${status}`} role="status">
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function App(): React.JSX.Element {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    void checkApiStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="#top">Klymon</a>
        <nav className="links">
          <a href="#features">Características</a>
          <a href="#download">Descargar</a>
          <a href="#faq">FAQ</a>
          <a href={repoUrl()} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <StatusPill status={status} />
      </header>

      <main id="top">
        <section className="hero">
          <p className="kicker">Launcher + cliente de Minecraft Java Edition</p>
          <h1>Juega Minecraft a tu manera.</h1>
          <p className="lede">
            Klymon instala el juego, los mods y Java por ti, y añade un cliente con HUD profesional,
            cosméticos y progresión local. Sin cuentas obligatorias para jugar.
          </p>
          <div className="cta">
            <a className="button primary" href={releasesUrl()} target="_blank" rel="noreferrer">
              Descargar para Windows, Linux y macOS
            </a>
            <a className="button" href={docsUrl()} target="_blank" rel="noreferrer">
              Documentación de la API
            </a>
          </div>
          <p className="fine">Versión actual 0.1.x · Instaladores sin firmar por ahora (SmartScreen avisará).</p>
        </section>

        <section id="features" className="section">
          <h2>Características</h2>
          <div className="grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="card">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="download" className="section">
          <h2>Descargar</h2>
          <p>
            Todas las versiones salen de <a href={releasesUrl()} target="_blank" rel="noreferrer">GitHub Releases</a>:
            instalador NSIS para Windows x64, AppImage/deb/rpm para Linux y dmg x64+arm64 para macOS.
            Cada release incluye los metadatos de auto-actualización.
          </p>
        </section>

        <section id="faq" className="section">
          <h2>Preguntas frecuentes</h2>
          <div className="faq">
            {FAQS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Klymon · MIT</span>
        <a href={repoUrl()} target="_blank" rel="noreferrer">Código fuente</a>
      </footer>
    </div>
  );
}
