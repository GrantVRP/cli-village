// The command palette (Ctrl+Shift+P, like VS Code): every command in one list.
// Type to filter, Enter to run. Commands that need a value (a commit message,
// an environment) ask for it in the same box.

import { el } from "../../web/src/lists.js";

export interface Command {
  id: string;
  title: string;
  /** The real command, or a note, shown under the title. */
  detail?: string;
  /** Extra words that should match when filtering. */
  keywords?: string;
  /** Ask for a value first. */
  input?: { label: string; placeholder?: string; initial?: string };
  run(value: string): void;
}

export class Palette {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly label: HTMLElement;
  private pending: Command | null = null;
  private selected = 0;
  private shown: Command[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly commands: () => Command[],
  ) {
    const box = el("div", "palette-box");
    this.label = el("div", "palette-label");
    this.input = el("input", "palette-input") as HTMLInputElement;
    this.input.type = "text";
    this.input.spellcheck = false;
    this.input.placeholder = "Type a command…";
    this.list = el("ol", "palette-list");
    box.append(this.label, this.input, this.list);
    root.replaceChildren(box);
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) this.close();
    });
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.pending = null;
    this.label.textContent = "";
    this.label.hidden = true;
    this.input.value = "";
    this.input.placeholder = "Type a command…";
    this.root.hidden = false;
    this.selected = 0;
    this.render();
    this.input.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.pending = null;
  }

  /** Ask for the value a command needs right away (the menus use this), or just run it. */
  prompt(command: Command): void {
    this.open();
    this.pick(command);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (this.pending || !this.shown.length) return;
      this.selected = (this.selected + (e.key === "ArrowDown" ? 1 : -1) + this.shown.length) % this.shown.length;
      this.render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.pending) {
        const command = this.pending;
        const value = this.input.value.trim();
        this.close();
        command.run(value);
      } else this.pick(this.shown[this.selected]);
    }
  }

  private pick(command: Command | undefined): void {
    if (!command) return;
    if (!command.input) {
      this.close();
      command.run("");
      return;
    }
    this.pending = command;
    this.label.textContent = command.input.label;
    this.label.hidden = false;
    this.input.value = command.input.initial ?? "";
    this.input.placeholder = command.input.placeholder ?? "";
    this.list.replaceChildren(el("li", "palette-hint", "Enter to run · Esc to cancel"));
    this.input.focus();
    this.input.select();
  }

  private render(): void {
    if (this.pending) return;
    const words = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (c: Command) => {
      const hay = `${c.title} ${c.detail ?? ""} ${c.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    // Words found in the name beat words found only in the keywords: "lighting night"
    // puts "lighting · Night" first, though every lighting command lists "night".
    const inTitle = (c: Command) => words.filter((w) => c.title.toLowerCase().includes(w)).length;
    this.shown = this.commands()
      .filter(matches)
      .map((c, i) => ({ c, i, score: inTitle(c) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ c }) => c);
    if (this.selected >= this.shown.length) this.selected = 0;
    this.list.replaceChildren(
      ...(this.shown.length
        ? this.shown.map((c, i) => {
            const li = el("li", i === this.selected ? "selected" : "");
            li.append(el("span", "palette-title", c.title), el("span", "palette-detail", c.detail ?? ""));
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              this.pick(c);
            });
            return li;
          })
        : [el("li", "palette-hint", "No matching commands")]),
    );
    this.list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
}
