// The page's first step: check this computer can draw the village (WebGL 2), then load it.
// Without WebGL 2 (no graphics driver, or one the browser blocks), the 3D code can't even
// start, and the page would wait forever. So it says so plainly instead. Everything outside
// the 3D view keeps working: `cli-village` in a terminal, and the desktop app's terminal,
// logs and tools.

// The page's look loads first, so it's styled either way (and never flashes unstyled).
import "./style.css";

function canDraw(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // A test context only: give it back at once (browsers allow only a few at a time).
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

if (canDraw()) {
  void import("./main.js");
} else {
  const text = (id: string, value: string) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  document.body.classList.toggle("embed", new URLSearchParams(location.search).get("embed") === "1");
  document.documentElement.dataset.webgl = "none";
  text("caption-icon", "!");
  text("caption-title", "This computer can't draw the 3D village");
  text(
    "caption-subtitle",
    "Its graphics (WebGL 2) aren't available here: there may be no graphics driver, or the browser blocks it. Everything else still works: in the desktop app, the terminal, logs and tools; anywhere, cli-village in a terminal.",
  );
}
