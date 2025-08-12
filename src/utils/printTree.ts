import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";

function shouldIgnoreItem(itemName: string, ignorePatterns: string[]): boolean {
	return ignorePatterns.some((pattern) => {
		if (pattern.includes("*")) {
			const regex = new RegExp(pattern.replace(/\*/g, ".*"));
			return regex.test(itemName);
		}
		return itemName === pattern;
	});
}

export function printTree(
	dirPath: string,
	ignorePatterns: string[],
	prefix = "",
	isLast = true,
): void {
	try {
		const items = fs.readdirSync(dirPath, { withFileTypes: true });
		const filteredItems = items.filter(
			(item) =>
				!item.name.startsWith(".") &&
				!shouldIgnoreItem(item.name, ignorePatterns),
		);

		filteredItems.forEach((item, index) => {
			const isLastItem = index === filteredItems.length - 1;
			const currentPrefix = prefix + (isLast ? "└── " : "├── ");
			const nextPrefix = prefix + (isLast ? "    " : "│   ");

			if (item.isDirectory()) {
				console.log(currentPrefix + chalk.blueBright(`${item.name}/`));
				const fullPath = path.join(dirPath, item.name);
				printTree(fullPath, ignorePatterns, nextPrefix, isLastItem);
			} else {
				console.log(currentPrefix + chalk.white(item.name));
			}
		});
	} catch (error) {
		console.error(chalk.red(`Error reading directory: ${error.message}`));
	}
}
