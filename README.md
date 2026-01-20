# Mealie Planner

Automated meal planning for [Mealie](https://mealie.io/) - generates weekly dinner plans based on recipe role tags.

## What is this?

Mealie Planner is a set of command-line tools that help you:

1. **Auto-tag recipes** (`auto-tag.js`) - Analyzes your recipes and automatically assigns role tags (protein, starch, vegetable) and meal categories (dinner, side, breakfast)
2. **Plan dinners** (`plan-dinner.js`) - Generates meal plans that ensure each dinner covers all three nutritional roles

### The Problem

Mealie's built-in meal planner requires manual recipe selection. If you have hundreds of recipes, planning balanced meals becomes tedious.

### The Solution

These scripts automate the process:
- Recipes get tagged based on their ingredients (chicken = protein, rice = starch, broccoli = vegetable)
- The planner picks recipes that together cover protein + starch + vegetable
- Recent recipes are avoided to keep variety

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A running [Mealie](https://mealie.io/) instance (v1.0+)
- A Mealie API token

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd mealie-planner
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Mealie server URL and API token:

```env
MEALIE_BASE=https://your-mealie-server.com
MEALIE_TOKEN=your_api_token_here
```

To get an API token:
1. Open Mealie in your browser
2. Go to Settings > API Tokens
3. Click "Create Token"
4. Copy the token to your `.env` file

### 3. Tag your recipes

First, run a dry run to see what changes would be made:

```bash
node auto-tag.js
```

If the output looks good, apply the changes:

```bash
node auto-tag.js --apply
```

### 4. Plan your meals

Preview a week of dinners:

```bash
node plan-dinner.js --dry
```

Actually create the meal plan entries in Mealie:

```bash
node plan-dinner.js
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEALIE_BASE` | Yes | - | Your Mealie server URL (no trailing slash) |
| `MEALIE_TOKEN` | Yes | - | Your Mealie API token |
| `START_DATE` | No | Today | Start date for planning (YYYY-MM-DD) |
| `DAYS` | No | 7 | Number of days to plan |
| `NO_REPEAT_DAYS` | No | 5 | Avoid repeating recipes within this many days |

### Command-Line Options

#### plan-dinner.js

```bash
node plan-dinner.js [options]

Options:
  --start YYYY-MM-DD  Start date (default: today)
  --days N            Number of days to plan (default: 7)
  --norepeat N        Avoid repeats within N days (default: 5)
  --dry               Preview without making changes
```

#### auto-tag.js

```bash
node auto-tag.js [options]

Options:
  --apply    Actually apply changes (default: dry run)
  --verbose  Show detailed ingredient analysis
```

## Usage Examples

### Plan two weeks starting next Monday

```bash
node plan-dinner.js --start 2025-01-27 --days 14 --dry
```

### Re-tag all recipes with verbose output

```bash
node auto-tag.js --verbose --apply
```

### Plan with stricter no-repeat window

```bash
node plan-dinner.js --norepeat 10 --dry
```

## How It Works

### Role Tags

The system uses three role tags to categorize recipes:

| Tag | Examples |
|-----|----------|
| `role:protein` | Chicken, beef, fish, tofu, eggs |
| `role:starch` | Rice, pasta, potatoes, bread |
| `role:vegetable` | Broccoli, salad, carrots, spinach |

### Meal Categories

Recipes are also categorized by meal type:

| Category | Description |
|----------|-------------|
| `dinner` | Main dishes (has substantial protein) |
| `side` | Side dishes (starch or vegetable without protein) |
| `breakfast` | Breakfast items (pancakes, waffles, etc.) |
| `dessert` | Sweets (excluded from meal planning) |

### Planning Algorithm

1. **Complete meals first**: If a recipe covers all three roles (like a stir-fry with chicken, rice, and vegetables), it gets picked alone
2. **Build from components**: Otherwise, recipes are combined to cover all roles
3. **Avoid repeats**: Recently used recipes are skipped for variety
4. **Prefer "pure" sides**: When filling the last role, single-role recipes are preferred to avoid overlap

## Troubleshooting

### "Please set MEALIE_BASE and MEALIE_TOKEN in .env"

Make sure you've:
1. Copied `.env.example` to `.env`
2. Filled in both `MEALIE_BASE` and `MEALIE_TOKEN`

### "GET ... -> 401"

Your API token is invalid or expired. Generate a new one in Mealie.

### "GET ... -> 404"

Check that `MEALIE_BASE` is correct and doesn't have a trailing slash.

### No recipes are being tagged

Run with `--verbose` to see the analysis:

```bash
node auto-tag.js --verbose
```

This shows which keywords are matching (or not matching) for each recipe.

### Meals aren't covering all roles

Check that you have enough recipes tagged with each role:

```bash
node plan-dinner.js --dry
```

Look at the "Pools" line in the output. You need recipes in each pool.

## Development

### Running Tests

```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
```

The test suite includes:

- **Unit tests** (`plan-dinner.test.js`, `auto-tag.test.js`) - Test pure functions without network calls
- **Integration tests** (`integration.test.js`) - Test actual Mealie API communication

Integration tests require a configured `.env` file with valid Mealie credentials. They are automatically skipped if credentials aren't available, so CI/CD pipelines won't fail.

### Project Structure

```
mealie-planner/
  plan-dinner.js      # Meal planning script
  auto-tag.js         # Recipe auto-tagging script
  package.json        # Dependencies and scripts
  .env.example        # Configuration template
  tests/
    plan-dinner.test.js   # Unit tests for plan-dinner.js
    auto-tag.test.js      # Unit tests for auto-tag.js
    integration.test.js   # API integration tests
```

### Adding New Keywords

Edit the keyword arrays at the top of `auto-tag.js`:

- `PROTEIN_KEYWORDS_SUBSTANTIAL` - Meats, fish, tofu
- `PROTEIN_KEYWORDS_MINOR` - Eggs, beans (not counted in baked goods)
- `STARCH_KEYWORDS` - Pasta, rice, potatoes
- `VEGETABLE_KEYWORDS` - All vegetables

## License

ISC
