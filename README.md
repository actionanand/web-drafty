# WebDrafty

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.11.

## Development server

To start a local development server, run:

```bash
npm run develop
```

Once the server is running, open your browser and navigate to `http://localhost:4313/`. The application will automatically reload whenever you modify any of the source files.

## Cloning Guide

1.  Clone only the remote primary HEAD (default: origin/main)

```bash
git clone <url> --single-branch
```

2. Only specific branch

```bash
git clone <url> --branch <branch> --single-branch [<folder>]
```

```bash
git clone <url> --branch <branch>
```

3. Cloning repositories using degit
   - main branch is default.

```bash
npx degit github:user/repo#branch-name <folder-name>
```

4. Cloning this project with skeleton

```bash
git clone https://github.com/actionanand/web-drafty.git --branch 1-skeleton angular-proj-name
```

```bash
npx degit github:actionanand/web-drafty#1-skeleton angular-proj-name
```

## Automate using `Prettier`, `Es Lint` and `Husky`

1. Install the compatible node version

```bash
  nvm install v24.11.1
```

2. Install and Configure Prettier
   - Install prettier as below:

   ```bash
     npm install prettier -D
   ```

   - Create a `.prettierrc.yml` file and write down the format as below: - [online ref](https://prettier.io/docs/en/options.html)

   ```yml
   trailingComma: 'all'
   tabWidth: 2
   useTabs: false
   semi: true
   singleQuote: true
   bracketSpacing: true
   bracketSameLine: true
   arrowParens: 'avoid'
   printWidth: 120
   overrides:
     - files:
         - '*.js'
         - '*.jsx'
       options:
         bracketSpacing: true
         jsxSingleQuote: true
         semi: true
         singleQuote: true
         tabWidth: 2
         useTabs: false
     - files:
         - '*.ts'
       options:
         tabWidth: 2
   ```

   - Create a `.prettierignore` file and write as below(sample)

   ```gitignore
   # Ignore artifacts:
   build
   coverage
   e2e
   node_modules
   dist
   dest
   reports

   # Ignore files
   *.lock
   package-lock.json
   yarn.lock
   ```

3. Install `Es Lint`, if not installed

```bash
ng add @angular-eslint/schematics
```

if error comes, use the below command

```shell
ng add @angular-eslint/schematics@21.0.0-alpha.1
# or
ng add @angular-eslint/schematics@next
```

4. Configure pre-commit hooks

Pre-commit hooks are a nice way to run certain checks to ensure clean code. This can be used to format staged files if for some reason they weren’t automatically formatted during editing. [husky](https://github.com/typicode/husky) can be used to easily configure git hooks to prevent bad commits. We will use this along with [pretty-quick](https://github.com/azz/pretty-quick) to run Prettier on our changed files. Install these packages, along with [npm-run-all](https://github.com/mysticatea/npm-run-all), which will make it easier for us to run npm scripts:

```bash
npm install -D husky pretty-quick npm-run-all
```

To configure the pre-commit hook, simply add a `precommit` npm script. We want to first run Prettier, then run TSLint on the formatted files. To make our scripts cleaner, I am using the npm-run-all package, which gives you two commands, `run-s` to run scripts in sequence, and `run-p` to run scripts in parallel:

```json
  "precommit": "run-s format:fix lint",
  "format:fix": "pretty-quick --staged",
  "format:check": "prettier --config ./.prettierrc --list-different \"src/{app,environments,assets}/**/*{.ts,.js,.json,.css,.scss}\"",
  "format:all": "prettier --config ./.prettierrc --write \"src/{app,environments,assets}/**/*{.ts,.js,.json,.css,.scss}\"",
  "lint": "ng lint",
```

5. Initialize husky
   - Run it once

   ```bash
     npx husky init
   ```

   - Add a hook

   ```bash
     echo "npm run precommit" > .husky/pre-commit
     echo "npm run test" > .husky/pre-commit
   ```

   - Make a commit

   ```bash
     git commit -m "Keep calm and commit"
     # `npm run precommit and npm test` will run every time you commit
   ```

6. How to skip prettier format only in particular file
   1. JS

   ```js
   matrix(1, 0, 0, 0, 1, 0, 0, 0, 1);

   // prettier-ignore
   matrix(
       1, 0, 0,
       0, 1, 0,
       0, 0, 1
     )
   ```

   2. JSX

   ```jsx
   <div>
     {/* prettier-ignore */}
     <span     ugly  format=''   />
   </div>
   ```

   3. HTML

   ```html
   <!-- prettier-ignore -->
   <div         class="x"       >hello world</div            >

   <!-- prettier-ignore-attribute -->
   <div
     (mousedown)="       onStart    (    )         "
     (mouseup)="         onEnd      (    )         "
   ></div>

   <!-- prettier-ignore-attribute (mouseup) -->
   <div (mousedown)="onStart()" (mouseup)="         onEnd      (    )         "></div>
   ```

   4. CSS

   ```css
   /* prettier-ignore */
   .my    ugly rule
     {
   
     }
   ```

   5. Markdown

   ```md
     <!-- prettier-ignore -->

   Do not format this
   ```

   6. YAML

   ```yml
   # prettier-ignore
   key  : value
     hello: world
   ```

   7. For more, please [check](https://prettier.io/docs/en/ignore.html)

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Important Angular 21.2+ Features

### 1. Arrow functions directly inside templates

In recent versions of Angular (21.2+), you can use arrow functions directly within template expressions, which is especially useful with Angular Signals.

```html
<!-- No separate component method required -->
<button (click)="count.update(n => n + 1)">Increment</button>
```

```ts
count = signal(0);
```

---

### 2. Improved Signal APIs

Signals are now deeply integrated into Angular and can replace many RxJS-based UI state patterns.

```ts
import { signal, computed } from '@angular/core';

count = signal(5);

doubleCount = computed(() => this.count() * 2);
```

```html
<p>{{ doubleCount() }}</p>
```

---

### 3. New control flow syntax (`@if`, `@for`, `@switch`)

Angular now provides built-in template control flow syntax with better readability and performance.

```html
@if (users.length > 0) {
<ul>
  @for (user of users; track user.id) {
  <li>{{ user.name }}</li>
  }
</ul>
} @else {
<p>No users found</p>
}
```

---

### 4. Deferrable views (`@defer`)

Lazy load template sections only when needed for better performance.

```html
@defer {
<heavy-chart />
} @loading {
<p>Loading chart...</p>
}
```

---

### 5. Standalone components by default

No need for NgModules in most applications.

```ts
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html',
})
export class HomeComponent {}
```

---

### 6. Better hydration and SSR support

Angular now includes improved server-side rendering and hydration for faster page loads and SEO improvements.

```bash
ng add @angular/ssr
```

---

### 7. Built-in zoneless change detection support

Angular now supports zoneless applications for better performance and predictable rendering.

```ts
bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
});
```

---

### 8. Resource API for async data

The new Resource API simplifies async state handling.

```ts
userResource = resource({
  loader: () => fetch('/api/user').then((r) => r.json()),
});
```

```html
@if (userResource.hasValue()) {
<p>{{ userResource.value().name }}</p>
}
```

---

### 9. Improved typed reactive forms

Reactive Forms now provide stronger type inference and safer form handling.

```ts
profileForm = new FormGroup({
  name: new FormControl<string>(''),
  age: new FormControl<number | null>(null),
});
```

---

### 10. Faster builds with Vite and esbuild

Modern Angular versions use faster tooling internally for development and production builds.

```bash
ng serve
```

Startup time and HMR performance are significantly improved compared to older Webpack-based setups.
