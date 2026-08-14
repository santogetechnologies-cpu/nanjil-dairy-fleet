import { runMigration } from "./migrate";

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute");
  
  if (!isExecute && !args.includes("--dry-run")) {
    console.log("No mode specified. Defaulting to DRY RUN mode.");
  }

  await runMigration(isExecute);
}

main().catch(err => {
  console.error("Unhandled Migration CLI Error:", err);
  process.exit(1);
});
