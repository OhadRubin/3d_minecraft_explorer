const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Parse command-line arguments
const args = process.argv.slice(2);
const isFirstTime = args.includes('--first-time');
const repoNameArg = args.find(arg => arg.startsWith('--repo-name='));
const providedRepoName = repoNameArg ? repoNameArg.split('=')[1] : null;

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Main function to run the setup and deployment
async function autoSetupAndDeploy() {
    try {
        if (isFirstTime) {
            console.log('\n🚀 First-time setup for GitHub Pages deployment...\n');
        } else {
            console.log('\n🚀 Deploying updates to GitHub Pages...\n');
        }

        // Check requirements
        try {
            execSync('gh --version', { stdio: 'ignore' });
            console.log('✓ GitHub CLI is installed');
        } catch (error) {
            console.error('❌ GitHub CLI is not installed. Please install it first:');
            console.error('   Visit: https://cli.github.com/');
            process.exit(1);
        }

        // Check if user is logged in to GitHub
        try {
            const whoami = execSync('gh auth status', { encoding: 'utf8' });
            console.log('✓ Logged in to GitHub');

            // Extract username from auth status output
            const usernameMatch = whoami.match(/Logged in to github\.com as (\w+)/);
            const username = usernameMatch ? usernameMatch[1] : 'github-user';

            if (isFirstTime) {
                // First-time setup
                let repoName;

                if (providedRepoName) {
                    repoName = providedRepoName;
                } else {
                    // Prompt for repository name if not provided
                    repoName = await new Promise((resolve) => {
                        rl.question('Enter a name for your GitHub repository: ', (answer) => {
                            resolve(answer || `react-app-${Date.now()}`);
                        });
                    });
                }

                // Update package.json with the new values
                console.log('📝 Updating package.json...');
                const packageJsonPath = path.join(process.cwd(), 'package.json');
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

                packageJson.homepage = `https://${username}.github.io/${repoName}`;

                fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
                console.log('✓ Updated package.json');

                // Force initialize a fresh git repository
                console.log('📁 Setting up git repository...');
                try {
                    // Remove any existing git directory
                    if (fs.existsSync('.git')) {
                        // On Windows, need different command for removing .git directory
                        const isWindows = process.platform === 'win32';
                        if (isWindows) {
                            execSync('rmdir /s /q .git', { stdio: 'ignore' });
                        } else {
                            execSync('rm -rf .git', { stdio: 'ignore' });
                        }
                    }

                    // Initialize a new git repository
                    execSync('git init', { stdio: 'inherit' });
                    execSync('git add .', { stdio: 'inherit' });
                    execSync('git commit -m "Initial commit"', { stdio: 'inherit' });
                    console.log('✓ Git repository initialized');

                    // Create GitHub repository and push
                    console.log(`\n🔧 Creating GitHub repository: ${repoName}...`);
                    execSync(`gh repo create ${repoName} --public --source=. --push`, { stdio: 'inherit' });
                    console.log('✓ GitHub repository created and code pushed');
                } catch (error) {
                    console.error('❌ Error setting up repository:', error.message);
                    process.exit(1);
                }
            } else {
                // For regular deployments, no repo creation needed
                console.log('Using existing repository configuration');
            }

            // Make sure required dependencies are installed
            console.log('\n📦 Ensuring required dependencies are installed...');
            try {
                execSync('npm list gh-pages || npm install gh-pages --save-dev', { stdio: 'inherit' });
                execSync('npm install @tailwindcss/postcss --save-dev', { stdio: 'inherit' });
                console.log('✓ Dependencies checked');
            } catch (error) {
                // Continue anyway, we'll use npx as a fallback
                console.log('⚠️ Could not verify dependencies, will use npx instead');
            }

            // Build the React app using create-react-app's build script
            console.log('\n🔨 Building React application...');
            try {
                // Try using the npm script first
                execSync('npm run build', { stdio: 'inherit' });
            } catch (error) {
                console.log('⚠️ Standard build failed, trying direct npx build...');
                try {
                    // If that fails, try using npx directly
                    execSync('npx react-scripts build', { stdio: 'inherit' });
                } catch (buildError) {
                    console.error('❌ Build failed. Try running: npm install react-scripts --save');
                    console.error('   Then run this script again.');
                    process.exit(1);
                }
            }
            console.log('✓ Application built successfully');

            // Deploy to GitHub Pages using gh-pages directly
            console.log('\n🚀 Deploying to GitHub Pages...');
            try {
                execSync('npx gh-pages -d build', { stdio: 'inherit' });
                console.log('✓ Deployed to GitHub Pages successfully');
            } catch (error) {
                console.error('❌ Deployment failed:', error.message);
                console.log('You can try deploying manually with: npx gh-pages -d build');
                process.exit(1);
            }

            // Get the homepage URL from package.json
            const packageJsonPath = path.join(process.cwd(), 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

            console.log(`\n🎉 Your app is now live at: ${packageJson.homepage}`);
            console.log('Note: It may take a few minutes for the site to be fully deployed.');

            // Close readline interface
            rl.close();

        } catch (error) {
            console.error('❌ Not logged in to GitHub. Please login with:');
            console.error('   Run: gh auth login');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ An error occurred:', error.message);
        process.exit(1);
    }
}

// Run the setup function
autoSetupAndDeploy();