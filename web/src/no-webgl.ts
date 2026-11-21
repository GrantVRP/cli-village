// When this computer can't draw the village: WebGL 2 is missing, or the browser blocks it
// (no graphics driver, or a blocklisted one). The 3D view can't start then, so the page
// says so plainly instead of waiting forever. Everything outside the 3D view keeps working:
// `cli-village` in a terminal, and the desktop app's terminal, logs and tools.
//
// It runs only after creating the real renderer failed (see main.ts): no test drawing
// context is made on computers that can draw.

export function showNoWebGL(): void {
  const text = (id: string, value: string) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  // style.css hides the parts that need the 3D view.
  document.documentElement.dataset.webgl = "none";
  text("caption-icon", "!");
  text("caption-title", "This computer can't draw the 3D village");
  text(
    "caption-subtitle",
    "Its graphics (WebGL 2) aren't available here: there may be no graphics driver, or the browser blocks it. Everything else still works: in the desktop app, the terminal, logs and tools; anywhere, cli-village in a terminal.",
  );
}
