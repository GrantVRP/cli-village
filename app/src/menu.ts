// The menu bar in the title bar (File, Edit, Selection, View, Go, Run, Terminal, Help),
// behaving like VS Code's: click a name to open it, slide along to the others, arrow
// keys to move, Enter to run, Esc to close. Items can be checked, disabled, or open a
// submenu. Every label is set as plain text.

import { el } from "../../web/src/lists.js";

export interface MenuItem {
  label: string;
  /** The shortcut shown on the right (the app itself handles the key). */
  keys?: string;
  run?: () => void;
  checked?: () => boolean;
  enabled?: () => boolean;
  items?: () => MenuEntry[];
}
export type MenuEntry = MenuItem | "-";

export interface Menu {
  label: string;
  items: () => MenuEntry[];
}

export class MenuBar {
  private readonly titles: HTMLButtonElement[] = [];
  private openAt = -1;
  private dropdown: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly menus: Menu[],
  ) {
    root.setAttribute("role", "menubar");
    menus.forEach((menu, i) => {
      const title = el("button", "menu-title", menu.label) as HTMLButtonElement;
      title.setAttribute("role", "menuitem");
      title.setAttribute("aria-haspopup", "true");
      title.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.openAt === i ? this.close() : this.open(i);
      });
      title.addEventListener("mouseenter", () => {
        if (this.openAt >= 0 && this.openAt !== i) this.open(i);
      });
      root.append(title);
      this.titles.push(title);
    });
    // A press outside the menus closes them. The open lists live in <body>, not in the bar,
    // so a press on an item must not count as outside (it would close before the click).
    addEventListener("mousedown", (e) => {
      const target = e.target as Element;
      if (this.openAt >= 0 && !root.contains(target) && !target.closest?.(".menu-list")) this.close();
    });
    addEventListener("blur", () => this.close());
    addEventListener("keydown", (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.openAt >= 0;
  }

  /** Alt+F opens File, Alt+E Edit, and so on (the first letter of each menu). */
  openByLetter(letter: string): boolean {
    const i = this.menus.findIndex((m) => m.label[0]!.toLowerCase() === letter.toLowerCase());
    if (i < 0) return false;
    this.open(i);
    return true;
  }

  open(i: number): void {
    this.close();
    const menu = this.menus[i];
    if (!menu) return;
    this.openAt = i;
    const title = this.titles[i]!;
    title.classList.add("open");
    title.setAttribute("aria-expanded", "true");
    this.dropdown = this.list(menu.items(), title.getBoundingClientRect().left, title.getBoundingClientRect().bottom);
    this.dropdown.classList.add("top");
    document.body.append(this.dropdown);
    this.focusItem(this.dropdown, 0);
  }

  close(): void {
    if (this.openAt < 0) return;
    const title = this.titles[this.openAt]!;
    title.classList.remove("open");
    title.removeAttribute("aria-expanded");
    this.openAt = -1;
    document.querySelectorAll(".menu-list").forEach((n) => n.remove());
    this.dropdown = null;
  }

  private list(entries: MenuEntry[], left: number, top: number): HTMLElement {
    const list = el("ul", "menu-list");
    list.setAttribute("role", "menu");
    list.style.left = `${Math.round(left)}px`;
    list.style.top = `${Math.round(top)}px`;
    for (const entry of entries) {
      if (entry === "-") {
        list.append(el("li", "menu-sep"));
        continue;
      }
      const li = el("li", "menu-item");
      li.setAttribute("role", "menuitem");
      li.tabIndex = -1;
      const enabled = entry.enabled?.() ?? true;
      if (!enabled) li.classList.add("disabled");
      const check = el("span", "menu-check", entry.checked?.() ? "✓" : "");
      li.append(check, el("span", "menu-label", entry.label));
      if (entry.items) li.append(el("span", "menu-more", "›"));
      else if (entry.keys) li.append(el("span", "menu-keys", entry.keys));
      if (entry.items) {
        li.addEventListener("mouseenter", () => this.openSub(li, entry));
        li.addEventListener("focus", () => this.openSub(li, entry));
      } else {
        li.addEventListener("mouseenter", () => {
          this.closeSubsUnder(list);
          li.focus();
        });
      }
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!enabled) return;
        if (entry.items) {
          this.openSub(li, entry);
          return;
        }
        this.close();
        entry.run?.();
      });
      list.append(li);
    }
    // Keep the whole list on screen.
    requestAnimationFrame(() => {
      const r = list.getBoundingClientRect();
      if (r.right > innerWidth - 4) list.style.left = `${Math.max(4, innerWidth - 4 - r.width)}px`;
      if (r.bottom > innerHeight - 4) list.style.top = `${Math.max(4, innerHeight - 4 - r.height)}px`;
    });
    return list;
  }

  private openSub(li: HTMLElement, entry: MenuItem): void {
    const parent = li.parentElement!;
    this.closeSubsUnder(parent);
    if (!entry.items) return;
    const r = li.getBoundingClientRect();
    const sub = this.list(entry.items(), r.right - 2, r.top - 4);
    sub.dataset.parent = "1";
    li.classList.add("open");
    (li as unknown as { sub: HTMLElement }).sub = sub;
    document.body.append(sub);
  }

  private closeSubsUnder(list: HTMLElement): void {
    for (const li of list.querySelectorAll<HTMLElement>(".menu-item.open")) {
      const sub = (li as unknown as { sub?: HTMLElement }).sub;
      if (sub) {
        this.closeSubsUnder(sub);
        sub.remove();
      }
      li.classList.remove("open");
    }
  }

  private focusItem(list: HTMLElement, index: number): void {
    const items = [...list.querySelectorAll<HTMLElement>(":scope > .menu-item:not(.disabled)")];
    if (!items.length) return;
    items[((index % items.length) + items.length) % items.length]!.focus();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.openAt < 0) return;
    const focused = document.activeElement as HTMLElement | null;
    const list = focused?.closest<HTMLElement>(".menu-list") ?? this.dropdown;
    if (!list) return;
    const items = [...list.querySelectorAll<HTMLElement>(":scope > .menu-item:not(.disabled)")];
    const at = focused ? items.indexOf(focused) : -1;
    if (e.key === "Escape") {
      this.close();
      this.titles[0]?.blur();
    } else if (e.key === "ArrowDown") this.focusItem(list, at + 1);
    else if (e.key === "ArrowUp") this.focusItem(list, at - 1);
    else if (e.key === "ArrowRight") {
      if (focused?.classList.contains("open")) this.focusItem((focused as unknown as { sub: HTMLElement }).sub, 0);
      else if (list.dataset.parent) return;
      else this.open((this.openAt + 1) % this.menus.length);
    } else if (e.key === "ArrowLeft") {
      if (list.dataset.parent) {
        const owner = document.querySelector<HTMLElement>(".menu-item.open");
        this.closeSubsUnder(owner!.parentElement!);
        owner!.focus();
      } else this.open((this.openAt - 1 + this.menus.length) % this.menus.length);
    } else if (e.key === "Enter" || e.key === " ") focused?.click();
    else if (e.key === "Home") this.focusItem(list, 0);
    else if (e.key === "End") this.focusItem(list, -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
