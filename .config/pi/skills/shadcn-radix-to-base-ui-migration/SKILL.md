---
name: shadcn-radix-to-base-ui-migration
description: Migration guide on how to move from radix to base-ui
---

## Quick Migration Checklist

- [ ] Update package installations (single package vs. individual packages)
- [ ] Replace `asChild` pattern with `render` and `nativeButton` props
- [ ] Update className/style patterns (now support function forms)
- [ ] Rename Radix parts to Base UI equivalents (e.g., `Content` → `Popup`, `Anchor` → handle patterns)
- [ ] Update event prop names and signatures
- [ ] Replace Portal `forceMount` with `keepMounted`
- [ ] Update data attribute assumptions
- [ ] Test animations and positioning behavior

---

## Major Differences

### 1. Package Installation

#### Radix (Individual Packages)

```bash
npm install @radix-ui/react-popover @radix-ui/react-dialog @radix-ui/react-select
```

```tsx
import { Popover } from "@radix-ui/react-popover";
import { Dialog } from "@radix-ui/react-dialog";
import { Select } from "@radix-ui/react-select";
```

#### Base UI (Single Package)

```bash
npm install @base-ui/react
```

```tsx
import { Popover } from "@base-ui/react/popover";
import { Dialog } from "@base-ui/react/dialog";
import { Select } from "@base-ui/react/select";
```

**Migration Tip**: Base UI is tree-shakable, so only imported components are bundled.

---

### 2. Rendering Custom Elements (asChild → render)

The biggest architectural difference. Radix uses `asChild` prop to merge props with a child component; Base UI uses explicit `render` and `nativeButton` props.

#### Radix Pattern

```tsx
import * as RadixPopover from "@radix-ui/react-popover";

<RadixPopover.Trigger asChild>
  <a href="/docs">Documentation</a>
</RadixPopover.Trigger>

<RadixPopover.Content asChild>
  <div className="custom-popup">Content</div>
</RadixPopover.Content>
```

#### Base UI Pattern

```tsx
import { Popover } from "@base-ui/react/popover";

// Option 1: Using render prop
<Popover.Trigger
  render={<a href="/docs" />}
  nativeButton={false}
>
  Documentation
</Popover.Trigger>

// Option 2: Using nativeButton={false} (renders as button but with enhanced semantics)
<Popover.Trigger nativeButton={false}>
  Documentation
</Popover.Trigger>

// For content
<Popover.Popup render={<div className="custom-popup" />}>
  Content
</Popover.Popup>
```

**Key Points**:
- `render` prop receives a JSX element to use as the component
- `nativeButton={false}` makes it keyboard-accessible but non-native
- More explicit than `asChild` - easier to understand what's happening

---

### 3. Styling Integration

#### Radix: Limited Styling Support

```tsx
<RadixPopover.Content asChild>
  <div className="PopoverContent">Content</div>
</RadixPopover.Content>
```

#### Base UI: First-Class Styling Support

```tsx
// String className
<Popover.Popup className="PopoverContent">
  Content
</Popover.Popup>

// Function className (receives state)
<Popover.Popup
  className={({ open, side }) => classNames(
    'popup',
    { 'popup--open': open },
    `popup--${side}`
  )}
>
  Content
</Popover.Popup>

// Style as object
<Popover.Popup style={{ padding: '16px' }}>
  Content
</Popover.Popup>

// Style as function (receives state)
<Popover.Popup
  style={({ open }) => ({
    opacity: open ? 1 : 0,
    transition: 'opacity 0.2s'
  })}
>
  Content
</Popover.Popup>
```

**Benefits**: Avoid wrapper divs and external components for state-based styling.

---

### 4. Component Part Naming Changes

Some parts have been renamed or restructured:

| Radix | Base UI | Notes |
|-------|---------|-------|
| `Popover.Content` | `Popover.Popup` | More semantic name |
| `Popover.Anchor` | Handle-based | Use `createHandle()` for detached triggers |
| `Dialog.Overlay` | `Dialog.Backdrop` | Clearer naming |
| `Select.Content` | `Select.Popup` | Consistent naming |
| Portal `forceMount` | Portal `keepMounted` | More intuitive naming |
| No separate Field component | `Field.Root` | Base UI includes form validation |

---

### 5. Portal Differences

#### Radix Portal

```tsx
<RadixPopover.Portal forceMount>
  <RadixPopover.Content>...</RadixPopover.Content>
</RadixPopover.Portal>
```

#### Base UI Portal

```tsx
<Popover.Portal keepMounted>
  <Popover.Popup>...</Popover.Popup>
</Popover.Portal>
```

Also supports custom containers:

```tsx
<Popover.Portal container={customElement}>
  <Popover.Popup>...</Popover.Popup>
</Popover.Portal>
```

---

### 6. Event Handlers & Callbacks

Most event handlers are similar but with subtle differences:

#### Dialog/Popover

```tsx
// Radix
<RadixPopover.Content
  onOpenAutoFocus={handleOpenAutoFocus}
  onCloseAutoFocus={handleCloseAutoFocus}
  onEscapeKeyDown={handleEscape}
  onPointerDownOutside={handleClickOutside}
/>

// Base UI - Same props available
<Popover.Popup
  initialFocus={ref}
  finalFocus={ref}
  // Events handled through Root
/>

<Popover.Root
  onOpenChange={handleOpenChange} // Receives (open, eventDetails)
>
  {/* ... */}
</Popover.Root>
```

---

### 7. Detached Triggers (Base UI Advantage)

Base UI's `.createHandle()` is cleaner than Radix's `Anchor` pattern:

#### Radix

```tsx
<RadixPopover.Root>
  <RadixPopover.Anchor asChild>
    <div>Anchor Point</div>
  </RadixPopover.Anchor>
  <RadixPopover.Trigger>Open</RadixPopover.Trigger>
  <RadixPopover.Portal>
    <RadixPopover.Content>...</RadixPopover.Content>
  </RadixPopover.Portal>
</RadixPopover.Root>
```

#### Base UI

```tsx
import { Popover } from "@base-ui/react/popover";

const popover = Popover.createHandle();

<Popover.Trigger handle={popover}>
  Open
</Popover.Trigger>

<Popover.Root handle={popover}>
  <Popover.Portal>
    <Popover.Popup>...</Popover.Popup>
  </Popover.Portal>
</Popover.Root>
```

**Advantage**: Handles can be typed for payload data:

```tsx
const popover = Popover.createHandle<{ id: string }>();

<Popover.Trigger handle={popover} payload={{ id: "item-1" }}>
  Item 1
</Popover.Trigger>

<Popover.Root handle={popover}>
  {({ payload }) => (
    <Popover.Popup>
      Content for {payload?.id}
    </Popover.Popup>
  )}
</Popover.Root>
```

---

### 8. Data Attributes

Both libraries use data attributes for CSS-based styling, but Base UI has more comprehensive coverage:

#### Radix Example

```css
[data-state="open"] { /* ... */ }
[data-side="bottom"] { /* ... */ }
[data-align="center"] { /* ... */ }
```

#### Base UI Example

```css
[data-open] { /* ...same as data-state="open" */ }
[data-closed] { /* ... */ }
[data-side="bottom"] { /* ... */ }
[data-align="center"] { /* ... */ }
[data-starting-style] { /* Animation entry */ }
[data-ending-style] { /* Animation exit */ }
[data-activation-direction] { /* From Viewport - useful for multi-trigger content transitions */ }
```

**Base UI provides more animation hooks** via data attributes.

---

### 9. Form Integration (Base UI Advantage)

Base UI includes a dedicated `Field` component for form validation:

```tsx
import { Field } from "@base-ui/react/field";
import { Select } from "@base-ui/react/select";

<Field.Root>
  <Field.Label>Choose theme</Field.Label>
  <Select.Root>
    {/* ... */}
  </Select.Root>
  <Field.Description>Light or dark mode</Field.Description>
  <Field.Error>Please select a theme</Field.Error>
</Field.Root>
```

**Radix** doesn't include this; you need external solutions like react-hook-form or zod.

---

### 10. CSS Variables & Positioning

#### Radix CSS Variables

```css
--radix-popover-content-transform-origin
--radix-popover-content-available-width
--radix-popover-trigger-width
```

#### Base UI CSS Variables

Base UI provides similar variables with consistent naming:

```css
--anchor-height
--anchor-width
--available-height
--available-width
--positioner-width
--positioner-height
--popup-width
--popup-height
--transform-origin
```

---

## Component Migration Examples

### Button Component

#### Radix

```tsx
import { Button as RadixButton } from "@radix-ui/react-primitive";

export const CustomButton = ({ asChild, ...props }) => (
  <RadixButton asChild={asChild} {...props} />
);

// Usage
<CustomButton asChild>
  <a href="/">Home</a>
</CustomButton>
```

#### Base UI

```tsx
import { Button } from "@base-ui/react/button";
import clsx from "clsx";

export const CustomButton = ({ className, ...props }) => (
  <Button
    className={clsx("btn", className)}
    {...props}
  />
);

// Usage - now just render naturally
<CustomButton onClick={handleClick}>
  Click me
</CustomButton>

// For link rendering
<CustomButton
  render={<a href="/" />}
  nativeButton={false}
>
  Home
</CustomButton>
```

---

### Dialog Component

#### Radix

```tsx
import * as Dialog from "@radix-ui/react-dialog";

export const MyDialog = () => (
  <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
    <Dialog.Trigger asChild>
      <button>Open</button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="overlay" />
      <Dialog.Content className="content">
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Description>Description</Dialog.Description>
        <Dialog.Close asChild>
          <button>Close</button>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
```

#### Base UI

```tsx
import { Dialog } from "@base-ui/react/dialog";

export const MyDialog = () => (
  <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
    <Dialog.Trigger>Open</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Popup className="content">
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Description>Description</Dialog.Description>
        <Dialog.Close>Close</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
);
```

**Cleaner**: No need for `asChild` on Trigger and Close buttons.

---

### Select Component

#### Radix (Limited Part Control)

```tsx
import * as Select from "@radix-ui/react-select";
import { ChevronDownIcon } from "@radix-ui/react-icons";

<Select.Root value={value} onValueChange={setValue}>
  <Select.Trigger>
    <Select.Value />
  </Select.Trigger>
  <Select.Content>
    <Select.Item value="apple">Apple</Select.Item>
    <Select.Item value="banana">Banana</Select.Item>
  </Select.Content>
</Select.Root>
```

#### Base UI (More Granular Control)

```tsx
import { Select } from "@base-ui/react/select";
import { Field } from "@base-ui/react/field";

const items = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
];

<Field.Root>
  <Field.Label>Choose fruit</Field.Label>
  <Select.Root items={items} value={value} onValueChange={setValue}>
    <Select.Trigger>
      <Select.Value />
      <Select.Icon />
    </Select.Trigger>
    <Select.Portal>
      <Select.Backdrop />
      <Select.Positioner>
        <Select.Popup>
          <Select.List>
            {items.map((item) => (
              <Select.Item key={item.value} value={item.value}>
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
</Field.Root>
```

**Benefits**:
- Built-in `Field` integration
- More explicit parts
- Better TypeScript support

---

## Migration Strategy

### Phase 1: Assessment
- List all Radix components used
- Check for custom `asChild` wrappers
- Identify styling patterns
- Document event handlers

### Phase 2: Dependency Update
```json
{
  "dependencies": {
    "@base-ui/react": "^1.0.0"
    // Remove individual @radix-ui packages
  }
}
```

### Phase 3: Component-by-Component
1. Start with small, isolated components (Button, Badge)
2. Move to compound components (Select, Popover)
3. Update dialogs and modals
4. Refactor forms with new Field component

### Phase 4: Testing
- Test keyboard navigation
- Verify animations
- Check focus management
- Validate accessibility (axe-core)

---

## Common Pitfalls

### ❌ Trying to use `asChild`
Base UI doesn't have `asChild`. Use `render` or `nativeButton={false}` instead.

### ❌ Forgetting string child content
When using `render`, children go inside the component tag:
```tsx
<Popover.Trigger render={<a />}>Text here</Popover.Trigger>
```

### ❌ Not handling Portal setup
Add to your root layout:
```css
.root {
  isolation: isolate;
}
```

### ❌ Missing `body { position: relative }` for iOS 26+
Required for proper modal/popover rendering on newer iOS.

### ❌ Using old Portal props
- Radix: `forceMount`
- Base UI: `keepMounted`

---

## Styling Patterns

### Tailwind CSS

Base UI works seamlessly with Tailwind:

```tsx
<Popover.Popup
  className={({ open, side }) => `
    ${open ? 'opacity-100' : 'opacity-0'}
    transition-opacity duration-200
    ${side === 'bottom' ? 'mt-2' : 'mb-2'}
  `}
>
  Content
</Popover.Popup>
```

### CSS Modules

```tsx
import styles from './popup.module.css';

<Popover.Popup
  className={({ side }) => classNames(
    styles.popup,
    styles[`popup--${side}`]
  )}
>
  Content
</Popover.Popup>
```

### CSS-in-JS

```tsx
import styled from 'styled-components';

const StyledPopup = styled(({ className, ...props }) => (
  <Popover.Popup className={className} {...props} />
))`
  &[data-open] {
    opacity: 1;
  }
  &[data-side="bottom"] {
    margin-top: 8px;
  }
`;
```

---

## Resources

- **Official Docs**: https://base-ui.com/react
- **Base UI Button Demo**: https://base-ui.com/react/components/button
- **Base UI Popover Demo**: https://base-ui.com/react/components/popover
- **Base UI Select Demo**: https://base-ui.com/react/components/select
- **GitHub Discussions**: https://github.com/mui/base-ui/discussions

---

## When to Choose Base UI Over Radix

✅ **Use Base UI if**:
- You need more flexible styling (function-based className/style)
- You want form validation out of the box (Field component)
- You prefer handles over `asChild` pattern
- You need comprehensive animation hooks
- You're starting a new project

✅ **Stick with Radix if**:
- Your codebase is thoroughly integrated with Radix
- You have custom `asChild` abstractions that are working well
- You prefer the lighter weight of individual packages
- Migration cost doesn't justify benefits for your team

---

## TypeScript Support

Base UI has excellent TypeScript support with full generic type parameters:

```tsx
const popover = Popover.createHandle<{ userId: string }>();

<Popover.Trigger handle={popover} payload={{ userId: "123" }}>
  User Details
</Popover.Trigger>

<Popover.Root handle={popover}>
  {({ payload }) => (
    <Popover.Popup>
      User: {payload.userId}
    </Popover.Popup>
  )}
</Popover.Root>
```

---

## Conclusion

Base UI represents the evolution of unstyled component design. While migration requires effort, the benefits include:
- **Better composability** via handles
- **Explicit styling** without wrapper divs
- **Form integration** with Field component
- **More animation hooks** for rich interactions
- **Cleaner API** without `asChild` magic

For new projects, **Base UI is the recommended choice**. For existing Radix projects, evaluate migration ROI based on your codebase size and styling needs.
