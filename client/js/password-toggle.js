const wrapped = new WeakSet();

function enhance(input) {
  if (wrapped.has(input)) return;
  wrapped.add(input);
  const holder = document.createElement("span");
  holder.className = "relative block";
  input.replaceWith(holder);
  holder.append(input);
  input.style.paddingRight = "4.5rem";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Show";
  button.setAttribute("aria-label", "Show password");
  button.className = "absolute inset-y-0 right-0 px-3 text-xs font-semibold text-forest-700";
  button.addEventListener("click", () => {
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    button.textContent = reveal ? "Hide" : "Show";
    button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  });
  holder.append(button);
}

function scan(root) {
  root.querySelectorAll?.('input[type="password"]').forEach(enhance);
}

export function initPasswordToggle() {
  scan(document);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('input[type="password"]')) enhance(node);
      else scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
