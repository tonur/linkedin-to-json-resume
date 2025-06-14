import LinkedInToJsonResume, { processors } from './converter';
import moment from 'moment';
import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';
import CSVToArray from './csvtoarray';

if (process.argv.length < 3) {
    console.error('Usage: node cli.js <linkedin-export.zip> [<output-directory> (optional)]');
    process.exit(1);
}

const zipFile = process.argv[2];
let outputDir = "";

// Check if argument 3 is provided for the output directory
if (process.argv.length >= 4)
{
    outputDir = process.argv[3];
    console.log(`Using output directory: ${outputDir}`);
    if (!fs.existsSync(outputDir))
    {
        console.error('Output directory "${outputDir}" does not exist.');
        process.exit(1);
    }
}

const linkedinToJsonResume = new LinkedInToJsonResume();

// Process the ZIP file
yauzl.open(zipFile, { lazyEntries: true }, async (err, zipfile) => {
    if (err) {
        console.error('Error opening ZIP file:', err);
        process.exit(1);
    }

    const entries: yauzl.Entry[] = [];
    const contents: { [key: string]: string } = {};

    // Function to read the contents of a file from the ZIP
    const readEntryContents = (entry: yauzl.Entry): Promise<string> => {
        return new Promise((resolve, reject) => {
            zipfile.openReadStream(entry, (err, readStream) => {
                if (err) return reject(err);
                let content = '';
                readStream.on('data', (chunk) => {
                    content += chunk;
                });
                readStream.on('end', () => {
                    contents[entry.fileName] = content;
                    resolve(content);
                });
                readStream.on('error', reject);
            });
        });
    };

    // First collect all entries
    zipfile.on('entry', async (entry) => {
        entries.push(entry);
        if (!entry.fileName.endsWith('/')) {
            try {
                await readEntryContents(entry);
            } catch (error) {
                console.error(`Error reading ${entry.fileName}:`, error);
            }
        }
        zipfile.readEntry();
    });

    // When we finish reading all entries, process them
    zipfile.on('end', async () => {
        // Ensure Profile.csv is first
        const profileIndex = entries.findIndex(
            (entry) => entry.fileName === "Profile.csv"
        );
        if (profileIndex !== -1) {
            const [profileEntry] = entries.splice(profileIndex, 1);
            entries.unshift(profileEntry);
        }

        // Ensure Skills.csv is processed before endorsements
        const skillsIndex = entries.findIndex(
            (entry) => entry.fileName === "Skills.csv"
        );
        if (skillsIndex !== -1) {
            const [skillsEntry] = entries.splice(skillsIndex, 1);
            entries.unshift(skillsEntry);
        }

        // Process each file in the ZIP
        const promises = entries.map((entry) => {
            const content = contents[entry.fileName];
            if (!content) return Promise.resolve();

            for (const [csvName, processor] of Object.entries(processors)) {
                if (entry.fileName.indexOf(csvName) !== -1) {
                    processor({ content, linkedinToJsonResume });
                    return Promise.resolve();
                }
            }
            return Promise.resolve();
        });

        await Promise.all(promises);

        // Save the result to a JSON file
        const output = linkedinToJsonResume.getOutput();
        const outputPath = path.join(outputDir, 'resume.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Successfully generated ${outputPath} file`);
    });

    zipfile.readEntry();
});
