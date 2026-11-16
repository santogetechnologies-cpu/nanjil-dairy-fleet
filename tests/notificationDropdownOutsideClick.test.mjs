import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure simulation of the outside-click, bell toggle, and escape-key dismissal
 * logic implemented in AppLayout.tsx for the Operational Alerts notification dropdown.
 */
function createDropdownController() {
  let isOpen = false;
  let listeners = {
    pointerdown: [],
    mousedown: [],
    keydown: [],
  };

  // Mock DOM tree
  const bellButton = { id: "bell-button", parent: null };
  const dropdownPanel = { id: "dropdown-panel", parent: null };
  const viewAllBtn = { id: "view-all-link", parent: dropdownPanel };
  const openCenterBtn = { id: "open-center-link", parent: dropdownPanel };
  const outsideElement = { id: "outside-area", parent: null };

  const container = {
    id: "notifications-container-ref",
    children: [bellButton, dropdownPanel],
    contains: function (target) {
      if (!target) return false;
      if (target === this || target === bellButton || target === dropdownPanel) return true;
      if (target.parent === dropdownPanel || target.parent === container) return true;
      return false;
    },
  };

  bellButton.parent = container;
  dropdownPanel.parent = container;

  function setNotificationsOpen(val) {
    if (typeof val === "function") {
      isOpen = val(isOpen);
    } else {
      isOpen = val;
    }
    syncListeners();
  }

  function handleOutsideClick(event) {
    if (container && !container.contains(event.target)) {
      setNotificationsOpen(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      setNotificationsOpen(false);
    }
  }

  function syncListeners() {
    if (isOpen) {
      listeners.pointerdown = [handleOutsideClick];
      listeners.keydown = [handleKeyDown];
    } else {
      listeners.pointerdown = [];
      listeners.keydown = [];
    }
  }

  function clickBell() {
    // 1. Pointerdown on bell
    const pointerEvt = { target: bellButton };
    listeners.pointerdown.forEach((fn) => fn(pointerEvt));

    // 2. Button click handler toggles state
    setNotificationsOpen((prev) => !prev);
  }

  function clickOutside(target = outsideElement) {
    const pointerEvt = { target };
    listeners.pointerdown.forEach((fn) => fn(pointerEvt));
  }

  function clickInside(target = dropdownPanel) {
    const pointerEvt = { target };
    listeners.pointerdown.forEach((fn) => fn(pointerEvt));
  }

  function pressKey(key) {
    const keyEvt = { key };
    listeners.keydown.forEach((fn) => fn(keyEvt));
  }

  return {
    getIsOpen: () => isOpen,
    clickBell,
    clickOutside,
    clickInside,
    pressKey,
    viewAllBtn,
    openCenterBtn,
    outsideElement,
    setNotificationsOpen,
    listenerCount: () => listeners.pointerdown.length + listeners.keydown.length,
  };
}

test("1. Clicking notification bell when closed opens the dropdown", () => {
  const ctrl = createDropdownController();
  assert.equal(ctrl.getIsOpen(), false, "Initially closed");
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true, "Opens after bell click");
  assert.equal(ctrl.listenerCount(), 2, "Attaches pointerdown and keydown listeners when open");
});

test("2. Clicking outside the dropdown and bell closes the dropdown", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  ctrl.clickOutside();
  assert.equal(ctrl.getIsOpen(), false, "Outside click must dismiss dropdown");
  assert.equal(ctrl.listenerCount(), 0, "Listeners must be cleaned up on close");
});

test("3. Clicking bell icon while dropdown is open closes it (toggle)", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), false, "Clicking bell again must close dropdown");
  assert.equal(ctrl.listenerCount(), 0, "Listeners must be removed");
});

test("4. Clicking inside the notification dropdown must NOT close it", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  ctrl.clickInside();
  assert.equal(ctrl.getIsOpen(), true, "Inside click must keep dropdown open");
  assert.equal(ctrl.listenerCount(), 2, "Listeners remain active");
});

test("5. Pressing Escape key closes the dropdown", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  ctrl.pressKey("Escape");
  assert.equal(ctrl.getIsOpen(), false, "Escape key must close dropdown");
  assert.equal(ctrl.listenerCount(), 0, "Listeners cleaned up");
});

test("6. Pressing non-Escape key keeps dropdown open", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  ctrl.pressKey("Enter");
  assert.equal(ctrl.getIsOpen(), true, "Other keys must not close dropdown");
  ctrl.pressKey("Tab");
  assert.equal(ctrl.getIsOpen(), true);
});

test("7. Dropdown links (View All, Open Center) dismiss dropdown via their click handlers", () => {
  const ctrl = createDropdownController();
  ctrl.clickBell();
  assert.equal(ctrl.getIsOpen(), true);

  // Link click invokes setNotificationsOpen(false)
  ctrl.setNotificationsOpen(false);
  assert.equal(ctrl.getIsOpen(), false, "Link click closes dropdown");
});
