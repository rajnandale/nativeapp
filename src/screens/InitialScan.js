import { SafeAreaView, StyleSheet, Text, View, Button } from 'react-native';
import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import SQLite from 'react-native-sqlite-storage';
import SSDeepTurboModule from '../../specs/NativeSSDeepModule';
import ScanProgressUI from '../components/ScanProgressUI';

const db = SQLite.openDatabase({ name: 'filehashes.db', location: 'default' });

export default function InitialScan() {
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState(0); // Overall progress (0 to 1)
    const [categories, setCategories] = useState({
        text: { totalFiles: 0, duplicates: 0, scanned: 0 },
        pptx: { totalFiles: 0, duplicates: 0, scanned: 0 },
        documents: { totalFiles: 0, duplicates: 0, scanned: 0 },
        audio: { totalFiles: 0, duplicates: 0, scanned: 0 },
        pdfs: { totalFiles: 0, duplicates: 0, scanned: 0 },
        image: { totalFiles: 0, duplicates: 0, scanned: 0 },
        video: { totalFiles: 0, duplicates: 0, scanned: 0 },
    });
    const startScan = async () => {
        setIsScanning(true);
        const isFirstLaunch = await checkFirstLaunch();
        if (isFirstLaunch == false) {
            const results = await performInitialScan();
            console.log('Initial scan completed:', results);
        }
        setIsScanning(false);
    };
    const fileCategories = {
        text: ['.txt'],
        pptx: ['.ppt', '.pptx'],
        documents: ['.docx', '.doc'],
        audio: ['.mp3', '.wav'],
        pdfs: ['.pdf'],
        // video: ['.mp4', '.mkv'],
        // image: ['.jpg', '.png'],
    };
    const scanFilesInCategory = async (category, extensions) => {
        const files = [];
        const directories = [`${RNFS.ExternalStorageDirectoryPath}/Download`]; // Start from root directory
        // Define ignored directories
        const ignoredPrefixes = [
            // 'com.',        // App-specific directories
            'cn.',         // App-specific directories
            '.cache',      // Cache directories
            'cache',      // Cache directories
            '.temp',       // Temporary files
            '.thumbnails', // Thumbnail cache
            '.trashed',     // 
            'MIUI',        // Xiaomi-specific system files
            'LOST.DIR',    // Recovered lost files
            'DCIM/.thumbnails', // Image thumbnails
            'Recycle.Bin', // Windows-style recycle bin
            '.Trash',      // Trash folder (Linux/Android)
            '.nomedia',    // Prevents media scanning
            'System Volume Information', // Windows system files
            'Alarms',      // Alarm sounds
            'Notifications', // Notification sounds
            'Ringtones',   // Ringtone sounds
            'obb',      // Pre-installed system 
            'data',       // Pre-installed system 
            'Podcasts'     // Pre-installed system podcasts
        ];
        console.log(directories)
        while (directories.length > 0) {
            const currentDir = directories.pop();
            // Check if current directory should be ignored
            if (ignoredPrefixes.some(prefix => currentDir.split('/').pop().startsWith(prefix))) {
                console.log(`Skipping: ${currentDir}`);
                continue; // Skip this directory
            }
            try {
                const items = await RNFS.readDir(currentDir);
                // console.log(items)
                for (const item of items) {
                    if (item.isDirectory()) {
                        directories.push(item.path); // Add non-ignored directories
                    } else if (extensions.some(ext => item.name.endsWith(ext))) {
                        files.push(item.path); // Add files that match the category
                    }
                }
            } catch (error) {
                console.warn(`Error accessing ${currentDir}: ${error.message}`);
            }
        }
        return files;
    };
    
    const insertHashIntoDatabase = (filePath, hash, filetype, fileName, fileSizeKB) => {
        return new Promise((resolve, reject) => {
            db.transaction((tx) => {
                tx.executeSql(
                    'INSERT INTO files (filepath, hash, file_type) VALUES (?, ?, ?)',
                    [filePath, hash, filetype],
                    () => resolve(),
                    (error) => reject(error)
                );
            });
        });
    };
    const fetchHashesFromDatabase = (filetype) => {
        return new Promise((resolve, reject) => {
            db.transaction((tx) => {
                tx.executeSql(
                    'SELECT hash FROM files WHERE file_type = ?',
                    [filetype],
                    (tx, results) => {
                        const hashes = [];
                        for (let i = 0; i < results.rows.length; i++) {
                            hashes.push(results.rows.item(i).hash);
                        }
                        resolve(hashes);
                    },
                    (error) => {
                        reject(error);
                    }
                );
            });
        });
    };
    const processFilesInCategory = async (category, files) => {
        console.log('In processFilesInCategory: ' + category);
        const hashes = [];
        const duplicates = [];
        for (const file of files) {
            try {
                // Get file metadata (size, name)
                const fileInfo = await RNFS.stat(file);
                const fileSizeKB = (fileInfo.size / 1024).toFixed(2); // Convert to KB
                const fileName = file.split('/').pop(); // Extract file name
                console.log(fileName)
                // Compute SSDeep hash
                const hash = await SSDeepTurboModule.hashFile(file);
                // Fetch existing hashes for this category
                const existingHashes = await fetchHashesFromDatabase(category);
                // Compare the hash with existing hashes
                const results = await SSDeepTurboModule.compareHashWithArray(hash, existingHashes, 55);
                if (results.length > 0) {
                    duplicates.push({ file, similarity: results[0].similarity });
                } else {
                    // Insert into database with file details
                    await insertHashIntoDatabase(file, hash, category, fileName, fileSizeKB);
                }
                hashes.push({ file, hash });
            } catch (error) {
                console.warn(`Error processing file: ${file}, ${error.message}`);
            }
        }
        return { hashes, duplicates };
    };    
    const performInitialScan = async () => {
        const results = {};
        for (const [category, extensions] of Object.entries(fileCategories)) {
            const files = await scanFilesInCategory(category, extensions);
            console.log(files)
            const { hashes, duplicates } = await processFilesInCategory(category, files);
            console.log('processFilesInCategory done for:' + extensions)
            results[category] = {
                totalFiles: files.length,
                duplicates: duplicates.length,
                duplicateFiles: duplicates, // Store duplicates
                files: hashes,
            };
            console.log(results)
            // Update UI with progress
            await updateProgress(category, files.length, duplicates.length, duplicates);
        }
        return results;
    };
    const updateProgress = (category, totalFilesCount, duplicates, duplicateFiles) => {
        // console.log(`Scanned ${totalFiles} ${category} files. Found ${duplicates} duplicates.`)
        setCategories((prev) => ({
            ...prev,
            [category]: {
                totalFiles: totalFilesCount,
                duplicates,
                scanned: prev[category].scanned + 1,
                duplicateFiles, // Store duplicate file paths and similarity
            },
        }));
        // Calculate overall progress
        const totalScanned = Object.values(categories).reduce(
            (sum, cat) => sum + cat.scanned,
            0
        );
        const totalFilesOverall = Object.values(categories).reduce(
            (sum, cat) => sum + cat.totalFiles,
            0
        );
        // Prevent division by zero
        const progressValue = totalFilesOverall > 0 ? totalScanned / totalFilesOverall : 0;
        setProgress(progressValue);
    };


    const checkFirstLaunch = async () => {
        const isFirstLaunch = await AsyncStorage.getItem('isFirstLaunch');
        if (isFirstLaunch === null) {
            await AsyncStorage.setItem('isFirstLaunch', 'false');
            console.log('First Launch: True');
            return true;
        }
        console.log('First Launch: False');
        return false;
    };

    return (
        <SafeAreaView style={{ flex: 1 }}>
            <ScanProgressUI progress={progress} categories={categories} />
            <Button
                title={isScanning ? 'Scanning...' : 'Start Initial Scan'}
                onPress={startScan}
                disabled={isScanning}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({});