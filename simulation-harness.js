import {
    C,
    DEF_REG_SIZE,
    createStandardizedAlgorithm,
    createStandardizedResult,
    PrivilegedWorldProvider,
    BotKnowledgeProvider,
    PrivilegedComponentProvider,
    DiscoveredComponentProvider,
    BotKnowledgeManager,
    BotExplorer,
    getCompId3D
} from './bot-logic.js';

const BETTER_TARGET_COOLDOWN = 5;

class WorldManager {
    constructor(worldConfig) {
        this.worldConfig = worldConfig;
        this.bounds = worldConfig.bounds || {
            minX: 0, maxX: 100,
            minY: 0, maxY: 100, 
            minZ: 0, maxZ: 100
        };
        this.isWalkableFunction = worldConfig.isWalkable || this.defaultIsWalkable;
        this.world3D = worldConfig.world3D || this.createWorld3D();
    }
    
    createWorld3D() {
        return {
            isWalkable: this.isWalkableFunction
        };
    }
    
    defaultIsWalkable(x, y, z) {
        return true;
    }
    
    getWorld3D() {
        return this.world3D;
    }
    
    getBounds() {
        return this.bounds;
    }
    
    createPrivilegedProvider() {
        return new PrivilegedWorldProvider(this.world3D, this.bounds);
    }
    
    updateWorld(newWorld3D) {
        this.world3D = newWorld3D;
    }
    
    isWithinBounds(x, y, z) {
        return x >= this.bounds.minX && x < this.bounds.maxX &&
               y >= this.bounds.minY && y < this.bounds.maxY &&
               z >= this.bounds.minZ && z < this.bounds.maxZ;
    }
    
    getAllWalkablePositions() {
        const walkablePositions = [];
        for (let x = this.bounds.minX; x < this.bounds.maxX; x++) {
            for (let y = this.bounds.minY; y < this.bounds.maxY; y++) {
                for (let z = this.bounds.minZ; z < this.bounds.maxZ; z++) {
                    if (this.world3D.isWalkable(x, y, z)) {
                        walkablePositions.push({ x, y, z });
                    }
                }
            }
        }
        return walkablePositions;
    }
    
    getTotalWalkableCells() {
        let totalWalkableCells = 0;
        for (let x = this.bounds.minX; x < this.bounds.maxX; x++) {
            for (let y = this.bounds.minY; y < this.bounds.maxY; y++) {
                for (let z = this.bounds.minZ; z < this.bounds.maxZ; z++) {
                    if (this.world3D.isWalkable(x, y, z)) {
                        totalWalkableCells++;
                    }
                }
            }
        }
        return totalWalkableCells;
    }
}

function createTestWorld(bounds, customIsWalkable = null) {
    const worldConfig = {
        bounds,
        isWalkable: customIsWalkable || ((x, y, z) => true)
    };
    return new WorldManager(worldConfig);
}

function createGeneratedWorld(bounds, terrainConfig = {}) {
    const {
        wallDensity = 0.1,
        seed = Math.random(),
        noiseThreshold = 0.3
    } = terrainConfig;
    
    const customIsWalkable = (x, y, z) => {
        const hash = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % 1000000;
        const normalized = Math.abs(hash) / 1000000;
        return normalized > wallDensity;
    };
    
    const worldConfig = {
        bounds,
        isWalkable: customIsWalkable
    };
    
    return new WorldManager(worldConfig);
}


class SensorReading {
    constructor(x, y, z, state) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.state = state;
    }
}

class SensorSimulator {
    constructor(worldDataProvider, sensorConfig = {}) {
        this.worldDataProvider = worldDataProvider;
        this.sensorConfig = {
            defaultRange: 15,
            useLineOfSight: true,
            ...sensorConfig
        };
    }
    
    scan(robotPosition, sensorRange = null, robotDirection = 0) {
        const range = sensorRange || this.sensorConfig.defaultRange;
        const detectedReadings = [];
        
        for (let deltaX = -range; deltaX <= range; deltaX++) {
            for (let deltaY = -range; deltaY <= range; deltaY++) {
                for (let deltaZ = -range; deltaZ <= range; deltaZ++) {
                    const distanceFromRobot = Math.sqrt(deltaX*deltaX + deltaY*deltaY + deltaZ*deltaZ);
                    
                    if (distanceFromRobot <= range) {
                        const candidatePosition = {
                            x: Math.floor(robotPosition.x) + deltaX,
                            y: Math.floor(robotPosition.y) + deltaY,
                            z: Math.floor(robotPosition.z) + deltaZ
                        };
                        
                        
                        if (!this.sensorConfig.useLineOfSight || this.hasLineOfSight(robotPosition, candidatePosition)) {
                            const isWalkable = this.worldDataProvider.isWalkable(candidatePosition.x, candidatePosition.y, candidatePosition.z);
                            const cellState = isWalkable ? C.WALKABLE : C.WALL;
                            if (this.isWithinBounds(candidatePosition)){

                                detectedReadings.push(new SensorReading(candidatePosition.x, candidatePosition.y, candidatePosition.z, cellState));
                            }
                            else{
                                detectedReadings.push(new SensorReading(candidatePosition.x, candidatePosition.y, candidatePosition.z, C.WALL));

                            }
                        }
                        
                    }
                }
            }
        }
        
        return detectedReadings;
    }
    
    isWithinBounds(position) {
        if (this.worldDataProvider.getBounds) {
            const bounds = this.worldDataProvider.getBounds();
            return position.x >= bounds.minX && position.x < bounds.maxX &&
                   position.y >= bounds.minY && position.y < bounds.maxY &&
                   position.z >= bounds.minZ && position.z < bounds.maxZ;
        }
        return true;
    }
    
    hasLineOfSight(fromPosition, toPosition) {
        return true;
    }
    
    updateSensorConfig(newConfig) {
        this.sensorConfig = { ...this.sensorConfig, ...newConfig };
    }
    
    getSensorConfig() {
        return { ...this.sensorConfig };
    }
}

class DirectionalSensorSimulator extends SensorSimulator {
    constructor(worldDataProvider, sensorConfig = {}) {
        super(worldDataProvider, sensorConfig);
        this.sensorConfig = {
            coneAngle: 90, 
            ...this.sensorConfig,
            ...sensorConfig
        };
    }
    
    scan(robotPosition, sensorRange = null, robotDirection = 0) {
        const range = sensorRange || this.sensorConfig.defaultRange;
        const detectedReadings = [];
        
        const directionVector = this.getDirectionVector(robotDirection);
        
        const cosHalfAngle = Math.cos((this.sensorConfig.coneAngle / 2) * (Math.PI / 180));
        
        for (let deltaX = -range; deltaX <= range; deltaX++) {
            for (let deltaY = -range; deltaY <= range; deltaY++) {
                for (let deltaZ = -range; deltaZ <= range; deltaZ++) {
                    const candidatePosition = {
                        x: Math.floor(robotPosition.x) + deltaX,
                        y: Math.floor(robotPosition.y) + deltaY,
                        z: Math.floor(robotPosition.z) + deltaZ
                    };
                    
                    if (candidatePosition.x === robotPosition.x && 
                        candidatePosition.y === robotPosition.y && 
                        candidatePosition.z === robotPosition.z) continue;
                    
                    if (this.isWithinBounds(candidatePosition) && 
                        this.isWithinDirectionalCone(robotPosition, candidatePosition, directionVector, cosHalfAngle)) {
                        
                        if (!this.sensorConfig.useLineOfSight || this.hasLineOfSight(robotPosition, candidatePosition)) {
                            const isWalkable = this.worldDataProvider.isWalkable(candidatePosition.x, candidatePosition.y, candidatePosition.z);
                            const cellState = isWalkable ? C.WALKABLE : C.WALL;
                            detectedReadings.push(new SensorReading(candidatePosition.x, candidatePosition.y, candidatePosition.z, cellState));
                        }
                    }
                }
            }
        }
        
        return detectedReadings;
    }
    
    getDirectionVector(robotDirection) {
        const directionMap = {
            0: { x: 0, y: 0, z: -1 },  
            1: { x: 1, y: 0, z: -1 },  
            2: { x: 1, y: 0, z: 0 },   
            3: { x: 1, y: 0, z: 1 },   
            4: { x: 0, y: 0, z: 1 },   
            5: { x: -1, y: 0, z: 1 },  
            6: { x: -1, y: 0, z: 0 },  
            7: { x: -1, y: 0, z: -1 }  
        };
        
        return directionMap[robotDirection] || { x: 0, y: 0, z: -1 };
    }
    
    isWithinDirectionalCone(robotPosition, candidatePosition, directionVector, cosHalfAngle) {
        const vectorToPoint = { 
            x: candidatePosition.x - robotPosition.x, 
            y: candidatePosition.y - robotPosition.y, 
            z: candidatePosition.z - robotPosition.z 
        };
        
        const distanceToPoint = Math.sqrt(
            vectorToPoint.x ** 2 + vectorToPoint.y ** 2 + vectorToPoint.z ** 2
        );
        
        if (distanceToPoint === 0) return false;
        
        const normalizedVectorToPoint = {
            x: vectorToPoint.x / distanceToPoint,
            y: vectorToPoint.y / distanceToPoint,
            z: vectorToPoint.z / distanceToPoint,
        };
        
        const dotProduct = directionVector.x * normalizedVectorToPoint.x +
                          directionVector.y * normalizedVectorToPoint.y +
                          directionVector.z * normalizedVectorToPoint.z;
        
        return dotProduct >= cosHalfAngle;
    }
}


class GroundTruthComponentAnalyzer {
    constructor(worldDataProvider, analysisConfig = {}) {
        this.worldDataProvider = worldDataProvider;
        this.analysisConfig = {
            regionSize: DEF_REG_SIZE,
            ...analysisConfig
        };
        this.componentGraph = {};
        this.componentLookupTable = {};
        this.isAnalyzed = false;
    }
    
    analyzeCompleteWorld() {
        if (!this.worldDataProvider.getBounds) {
            throw new Error('World data provider must implement getBounds method');
        }
        
        const worldBounds = this.worldDataProvider.getBounds();
        const regionSize = this.analysisConfig.regionSize;
        
        this.componentGraph = {};
        this.componentLookupTable = {};
        
        const regionBoundsMap = this.calculateRegionBounds(worldBounds, regionSize);
        
        for (const [regionKey, bounds] of Object.entries(regionBoundsMap)) {
            const [regionX, regionY, regionZ] = regionKey.split(',').map(Number);
            const { worldStartX, worldStartY, worldStartZ } = getRegionStart(regionX, regionY, regionZ, regionSize);
            
            const components = this.findComponentsInRegion(
                worldStartX, worldStartY, worldStartZ, 
                regionSize, regionSize, regionSize
            );
            
            const newComponentNodes = createComponentNodes(components, regionX, regionY, regionZ);
            Object.assign(this.componentGraph, newComponentNodes);
            
            this.updateComponentMaze(components, regionX, regionY, regionZ);
        }
        
        this.detectComponentEdges();
        
        this.isAnalyzed = true;
        return {
            componentGraph: this.componentGraph,
            componentLookupTable: this.componentLookupTable
        };
    }
    
    calculateRegionBounds(worldBounds, regionSize) {
        const regionBoundsMap = {};
        
        const minRegionX = Math.floor(worldBounds.minX / regionSize);
        const maxRegionX = Math.floor(worldBounds.maxX / regionSize);
        const minRegionY = Math.floor(worldBounds.minY / regionSize);
        const maxRegionY = Math.floor(worldBounds.maxY / regionSize);
        const minRegionZ = Math.floor(worldBounds.minZ / regionSize);
        const maxRegionZ = Math.floor(worldBounds.maxZ / regionSize);
        
        for (let regionX = minRegionX; regionX <= maxRegionX; regionX++) {
            for (let regionY = minRegionY; regionY <= maxRegionY; regionY++) {
                for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ++) {
                    const regionKey = `${regionX},${regionY},${regionZ}`;
                    const { worldStartX, worldStartY, worldStartZ } = getRegionStart(regionX, regionY, regionZ, regionSize);
                    
                    regionBoundsMap[regionKey] = {
                        worldStartX,
                        worldStartY,
                        worldStartZ,
                        worldEndX: worldStartX + regionSize,
                        worldEndY: worldStartY + regionSize,
                        worldEndZ: worldStartZ + regionSize
                    };
                }
            }
        }
        
        return regionBoundsMap;
    }
    
    findComponentsInRegion(regionStartX, regionStartY, regionStartZ, regionSizeX, regionSizeY, regionSizeZ) {
        return findComps3D(this.worldDataProvider, regionStartX, regionStartY, regionStartZ, this.analysisConfig.regionSize, {
            walkabilityCheck: (world, x, y, z) => this.worldDataProvider.isWalkable(x, y, z)
        });
    }
    
    createVisitedArray(sizeX, sizeY, sizeZ) {
        return Array(sizeX).fill(null).map(() => 
            Array(sizeY).fill(null).map(() => 
                Array(sizeZ).fill(false)
            )
        );
    }
    
    floodFill3D(startX, startY, startZ, regionSizeX, regionSizeY, regionSizeZ, 
                visited, componentId, components, worldStartX, worldStartY, worldStartZ) {
        const floodFillInner = (localX, localY, localZ, currentComponentId) => {
            if (localX < 0 || localX >= regionSizeX || 
                localY < 0 || localY >= regionSizeY || 
                localZ < 0 || localZ >= regionSizeZ || 
                visited[localX][localY][localZ]) {
                return;
            }
            
            const worldX = worldStartX + localX;
            const worldY = worldStartY + localY;
            const worldZ = worldStartZ + localZ;
            
            if (!this.worldDataProvider.isWalkable(worldX, worldY, worldZ)) return;
            
            visited[localX][localY][localZ] = true;
            components[currentComponentId].push({ x: worldX, y: worldY, z: worldZ });
            
            const connectivity = this.getConnectivityPattern();
            for (const [deltaX, deltaY, deltaZ] of connectivity) {
                floodFillInner(localX + deltaX, localY + deltaY, localZ + deltaZ, currentComponentId);
            }
        };
        
        floodFillInner(startX, startY, startZ, componentId);
    }
    
    getConnectivityPattern() {
        const connectivity = [];
        for (let deltaX = -1; deltaX <= 1; deltaX++) {
            for (let deltaY = -1; deltaY <= 1; deltaY++) {
                for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
                    if (deltaX === 0 && deltaY === 0 && deltaZ === 0) continue;
                    connectivity.push([deltaX, deltaY, deltaZ]);
                }
            }
        }
        return connectivity;
    }
    
    createComponentNodes(components, regionX, regionY, regionZ) {
        return createComponentNodes(components, regionX, regionY, regionZ);
    }
    
    updateComponentMaze(components, regionX, regionY, regionZ) {
        updateComponentMaze(this.componentLookupTable, components, regionX, regionY, regionZ);
    }
    
    detectComponentEdges() {
        detectComponentEdges(this.componentGraph, this.worldDataProvider, this.componentLookupTable, this.analysisConfig.regionSize, {
            walkabilityCheck: (world, x, y, z) => this.worldDataProvider.isWalkable(x, y, z)
        });
    }
    
    areDifferentRegions(pos1, pos2) {
        const region1 = getRegionCoords(pos1, this.analysisConfig.regionSize);
        const region2 = getRegionCoords(pos2, this.analysisConfig.regionSize);
        
        return region1.regionX !== region2.regionX || 
               region1.regionY !== region2.regionY || 
               region1.regionZ !== region2.regionZ;
    }
    
    getComponentIdFromMaze(position) {
        return getCompId3D(position, this.componentLookupTable, this.analysisConfig.regionSize);
    }
    
    addBidirectionalEdge(componentId1, componentId2, fromCell, toCell) {
        if (!this.componentGraph.hasNode(componentId1) || !this.componentGraph.hasNode(componentId2)) return;
        
        const transitionData = {
            fromCell: fromCell,
            toCell: toCell
        };
        
        this.componentGraph.addEdge(componentId1, componentId2, transitionData);
    }
    
    createGroundTruthProvider() {
        if (!this.isAnalyzed) {
            this.analyzeCompleteWorld();
        }
        
        return {
            getComponentGraph: () => this.componentGraph,
            getComponentLookupTable: () => this.componentLookupTable,
            getCompId: (position) => this.getComponentIdFromMaze(position)
        };
    }
    
    getAnalysisResults() {
        if (!this.isAnalyzed) {
            this.analyzeCompleteWorld();
        }
        
        return {
            componentGraph: this.componentGraph,
            componentLookupTable: this.componentLookupTable,
            analysisConfig: this.analysisConfig
        };
    }
}


class ExplorationMetricCalculator {
    calculate(botKnowledgeProvider) {
        throw new Error('calculate method must be implemented by subclass');
    }
}

class CoverageCalculator extends ExplorationMetricCalculator {
    constructor(privilegedWorldProvider, regionBounds) {
        super();
        this.privilegedWorldProvider = privilegedWorldProvider;
        this.regionBounds = regionBounds;
        this.cachedTotalWalkableCells = null;
        this.cachedBounds = null;
    }
    
    calculate(botKnowledgeProvider) {
        const totalWalkableCells = this.calculateTotalWalkableCells(this.regionBounds);
        const knownWalkableCells = this.calculateKnownWalkableCells(botKnowledgeProvider, this.regionBounds);
        
        return totalWalkableCells > 0 ? (knownWalkableCells / totalWalkableCells) * 100 : 0;
    }
    
    calculateTotalWalkableCells(regionBounds) {
        if (this.cachedTotalWalkableCells !== null && this.areBoundsEqual(this.cachedBounds, regionBounds)) {
            return this.cachedTotalWalkableCells;
        }
        
        const { minX, maxX, minY, maxY, minZ, maxZ } = regionBounds;
        let totalWalkableCells = 0;
        
        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                for (let z = minZ; z < maxZ; z++) {
                    if (this.privilegedWorldProvider.isWalkable(x, y, z)) {
                        totalWalkableCells++;
                    }
                }
            }
        }
        
        this.cachedTotalWalkableCells = totalWalkableCells;
        this.cachedBounds = { ...regionBounds };
        
        return totalWalkableCells;
    }
    
    calculateKnownWalkableCells(botKnowledgeProvider, regionBounds) {
        const { minX, maxX, minY, maxY, minZ, maxZ } = regionBounds;
        let knownWalkableCells = 0;
        
        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                for (let z = minZ; z < maxZ; z++) {
                    if (this.privilegedWorldProvider.isWalkable(x, y, z)) { 
                        const cellKnowledgeState = botKnowledgeProvider.getCellState(x, y, z); 
                        if (cellKnowledgeState !== C.UNKNOWN) {
                            knownWalkableCells++;
                        }
                    }
                }
            }
        }
        
        return knownWalkableCells;
    }
    
    areBoundsEqual(bounds1, bounds2) {
        if (!bounds1 || !bounds2) return false;
        
        return bounds1.minX === bounds2.minX &&
               bounds1.maxX === bounds2.maxX &&
               bounds1.minY === bounds2.minY &&
               bounds1.maxY === bounds2.maxY &&
               bounds1.minZ === bounds2.minZ &&
               bounds1.maxZ === bounds2.maxZ;
    }
    
    getDetailedCoverageStats(botKnowledgeProvider) {
        const totalWalkableCells = this.calculateTotalWalkableCells(this.regionBounds);
        const knownWalkableCells = this.calculateKnownWalkableCells(botKnowledgeProvider, this.regionBounds);
        const coverage = totalWalkableCells > 0 ? (knownWalkableCells / totalWalkableCells) * 100 : 0;
        
        // Calculate totalCells (world volume) and knownPercentage that was moved from robot code
        const { minX, maxX, minY, maxY, minZ, maxZ } = this.regionBounds;
        const totalCells = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
        
        const robotStats = botKnowledgeProvider.terrainKnowledge ? 
            botKnowledgeProvider.terrainKnowledge.getDiscoveryStats() : 
            { knownCells: 0, walkableCells: 0, wallCells: 0 };
        
        return {
            totalWalkableCells,
            knownWalkableCells,
            unknownWalkableCells: totalWalkableCells - knownWalkableCells,
            coverage,
            totalCells,
            knownPercentage: totalCells > 0 ? (robotStats.knownCells / totalCells) * 100 : 0,
            regionBounds: this.regionBounds
        };
    }
}

class EfficiencyCalculator extends ExplorationMetricCalculator {
    constructor(privilegedWorldProvider, privilegedComponentProvider) {
        super();
        this.privilegedWorldProvider = privilegedWorldProvider;
        this.privilegedComponentProvider = privilegedComponentProvider;
        this.totalPathLength = 0;
        this.optimalPathLength = 0;
    }
    
    calculate(botKnowledgeProvider) {
        if (this.optimalPathLength === 0) return 100; 
        
        const efficiency = (this.optimalPathLength / this.totalPathLength) * 100;
        return Math.min(100, efficiency); 
    }
    
    updatePathLength(pathLength, optimalLength) {
        this.totalPathLength += pathLength;
        this.optimalPathLength += optimalLength;
    }
    
    reset() {
        this.totalPathLength = 0;
        this.optimalPathLength = 0;
    }
}

class ComponentDiscoveryCalculator extends ExplorationMetricCalculator {
    constructor(privilegedComponentProvider) {
        super();
        this.privilegedComponentProvider = privilegedComponentProvider;
    }
    
    calculate(discoveredComponentProvider) {
        const privilegedComponents = this.privilegedComponentProvider.getComponentGraph();
        const discoveredComponents = discoveredComponentProvider.getComponentGraph();
        
        const totalComponents = Object.keys(privilegedComponents).length;
        const discoveredComponentsCount = Object.keys(discoveredComponents).length;
        
        return totalComponents > 0 ? (discoveredComponentsCount / totalComponents) * 100 : 0;
    }
    
    getDetailedDiscoveryStats(discoveredComponentProvider) {
        const privilegedComponents = this.privilegedComponentProvider.getComponentGraph();
        const discoveredComponents = discoveredComponentProvider.getComponentGraph();
        
        const totalComponents = Object.keys(privilegedComponents).length;
        const discoveredComponentsCount = Object.keys(discoveredComponents).length;
        const discoveryPercentage = totalComponents > 0 ? (discoveredComponentsCount / totalComponents) * 100 : 0;
        
        return {
            totalComponents,
            discoveredComponents: discoveredComponentsCount,
            undiscoveredComponents: totalComponents - discoveredComponentsCount,
            discoveryPercentage,
            componentIds: {
                privileged: Object.keys(privilegedComponents),
                discovered: Object.keys(discoveredComponents)
            }
        };
    }
}

class CompositeMetricsCalculator {
    constructor(calculators, weights = {}) {
        this.calculators = calculators || [];
        this.weights = {
            coverage: 0.5,
            efficiency: 0.3,
            componentDiscovery: 0.2,
            ...weights
        };
    }
    
    calculateAll(botKnowledgeProvider, discoveredComponentProvider = null) {
        const results = {};
        
        for (const calculator of this.calculators) {
            const calculatorName = calculator.constructor.name.replace('Calculator', '').toLowerCase();
            
            try {
                if (calculator.constructor.name === 'ComponentDiscoveryCalculator') {
                    if (discoveredComponentProvider) {
                        results[calculatorName] = calculator.calculate(discoveredComponentProvider);
                    } else {
                        results[calculatorName] = 0;
                    }
                } else {
                    results[calculatorName] = calculator.calculate(botKnowledgeProvider);
                }
            } catch (error) {
                console.warn(`Error calculating ${calculatorName}:`, error);
                results[calculatorName] = 0;
            }
        }
        
        results.compositeScore = this.calculateCompositeScore(results);
        return results;
    }
    
    calculateCompositeScore(results) {
        let weightedSum = 0;
        let totalWeight = 0;
        
        for (const [metricName, weight] of Object.entries(this.weights)) {
            if (results[metricName] !== undefined) {
                weightedSum += results[metricName] * weight;
                totalWeight += weight;
            }
        }
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    
    addCalculator(calculator, weight = 1) {
        this.calculators.push(calculator);
        const calculatorName = calculator.constructor.name.replace('Calculator', '').toLowerCase();
        this.weights[calculatorName] = weight;
    }
    
    updateWeights(newWeights) {
        this.weights = { ...this.weights, ...newWeights };
    }
}


class SimulationHarness {
    constructor(simulationConfig) {
        this.config = simulationConfig;
        this.worldManager = null;
        this.sensorSimulator = null;
        this.groundTruthAnalyzer = null;
        this.coverageCalculator = null;
        this.metricsCalculator = null;
        this.botExplorer = null;
        this.botKnowledge = null;
        this.simulationState = null;
    }
    
    async initialize(worldConfig, botConfig) {
        this.worldManager = new WorldManager(worldConfig);
        this.sensorSimulator = new SensorSimulator(this.worldManager.createPrivilegedProvider());
        this.groundTruthAnalyzer = new GroundTruthComponentAnalyzer(this.worldManager.createPrivilegedProvider());
        const regionBounds = worldConfig.regionBounds || worldConfig.bounds;
        this.coverageCalculator = new CoverageCalculator(this.worldManager.createPrivilegedProvider(), regionBounds);
        this.metricsCalculator = new CompositeMetricsCalculator();
        
        this.botKnowledge = new BotKnowledgeManager(botConfig.startPosition);
        this.botExplorer = new BotExplorer(botConfig);
        
        this.simulationState = {
            currentPosition: { ...botConfig.startPosition },
            currentDirection: 0,
            currentTarget: null,
            iteration: 0,
            stuckCounter: 0,
            explorationPath: [{ ...botConfig.startPosition }],
            failedTargets: new Map(), 
            metrics: {},
            betterTargetCooldown: 0,
            accumulatedNewCells: [],
            lastIterationNewCells: [],
        };
    }
    
    async runSimulation(input, options = {}, onProgress = null) {
        const {
            expThresh = 100,        
            delay = 0,              // Removed artificial delay for speed
            maxIter = 1000000,      
            sRange = 15,            
            stepSize = 1.0,         
            scan360 = true          
        } = options;

        const initialSensorReadings = this.sensorSimulator.scan(this.simulationState.currentPosition, sRange, this.simulationState.currentDirection);
        const updateResult = this.botKnowledge.updateFromSensorReadings(initialSensorReadings);

        if (updateResult.newCells.length > 0) {
            const worldProvider = this.botKnowledge.getWorldDataProvider();
            const componentProvider = this.botKnowledge.getComponentProvider();
            const componentUpdate = await this.botKnowledge.componentManager.updateComponents(
                worldProvider,
                componentProvider.getGraph(),
                componentProvider.getMaze(),
                updateResult.newCells
            );
            this.botKnowledge.componentGraph = componentUpdate.componentGraph;
            this.botKnowledge.componentColoredMaze = componentUpdate.coloredMaze;
        }

        while (this.simulationState.iteration < maxIter) {
            this.simulationState.iteration++;
            
            if (this.simulationState.iteration % 100 === 0) {
                console.log(`Exploration iteration ${this.simulationState.iteration}, robot position: (${this.simulationState.currentPosition.x}, ${this.simulationState.currentPosition.y}, ${this.simulationState.currentPosition.z})`);
                if (onProgress) {
                    try {
                        await onProgress({ type: 'check_cancel' });
                    } catch (e) { throw e; }
                }
            }
            
            await this.performSensorScanning(this.simulationState.currentPosition, this.simulationState.currentDirection, sRange);
            
            const coverage = this.coverageCalculator.calculate(this.botKnowledge.getWorldDataProvider());
            
            if (coverage >= expThresh) {
                console.log(`Exploration complete - coverage threshold ${expThresh}% reached`);
                break;
            }

            const decisionState = {
                ...this.botKnowledge.getExplorationState(),
                // IMPORTANT: Use simulation state's current target, not BotKnowledgeManager's stale one
                currentTarget: this.simulationState.currentTarget,
                worldDataProvider: this.botKnowledge.getWorldDataProvider(),
                componentProvider: this.botKnowledge.getComponentProvider(),
                stuckCounter: this.simulationState.stuckCounter,
                failedTargets: this.simulationState.failedTargets,
            };
            const botDecision = await this.botExplorer.decideNextAction(decisionState);
            const previousTarget = this.simulationState.currentTarget;
            
            // Handle adding current target to previousTargets if needed
            if (botDecision.shouldAddCurrentTargetToPrevious && this.simulationState.currentTarget) {
                this.botKnowledge.addToPreviousTargets(this.simulationState.currentTarget);
            }
            
            this.simulationState.currentTarget = botDecision.target;
            

            if (!this.simulationState.currentTarget) {
                console.log('No valid target found - exploration complete');
                break;
            }

            const explorationState = this.botKnowledge.getExplorationState();
            // IMPORTANT: Always use current simulation position, not botKnowledge position
            explorationState.robotPosition = this.simulationState.currentPosition;
            explorationState.target = this.simulationState.currentTarget;
            explorationState.worldDataProvider = this.botKnowledge.getWorldDataProvider();
            explorationState.componentProvider = this.botKnowledge.getComponentProvider();
            explorationState.explorationPath = explorationState.explorationPath.slice(1);
            
            console.log(`[Simulation] About to execute movement - Target: (${explorationState.target?.x},${explorationState.target?.y},${explorationState.target?.z}), Robot: (${this.simulationState.currentPosition.x},${this.simulationState.currentPosition.y},${this.simulationState.currentPosition.z})`);
            
            let movementPlan = await this.botExplorer.executeMovement(explorationState);



            if ( (movementPlan.success && movementPlan.path && movementPlan.path.length > 3 && this.simulationState.betterTargetCooldown <= 0)) {
                const betterTarget = await this.botExplorer.checkForBetterTarget(decisionState, botDecision.frontiers, movementPlan.cost);
                if (betterTarget) {
                    console.log(`[Opportunistic Switch] Abandoning target (${this.simulationState.currentTarget.x},${this.simulationState.currentTarget.y},${this.simulationState.currentTarget.z}) for better target (${betterTarget.x},${betterTarget.y},${betterTarget.z})`);
                    
                    // Add current target to previousTargets before switching (like HTML version)
                    this.botKnowledge.addToPreviousTargets(this.simulationState.currentTarget);
                    
                    this.simulationState.currentTarget = betterTarget;
                    this.botKnowledge.updateTargetTracking(betterTarget, this.botKnowledge.previousTargets);

                    const newExplorationState = { ...explorationState, target: betterTarget };
                    movementPlan = await this.botExplorer.executeMovement(newExplorationState);

                    this.simulationState.betterTargetCooldown = BETTER_TARGET_COOLDOWN; 
                }
            }


            // Clear accumulated new cells from previous iteration
            this.simulationState.lastIterationNewCells = [...this.simulationState.accumulatedNewCells];
            this.simulationState.accumulatedNewCells = [];

            await this.executeMovement(movementPlan, sRange);
            
            // Check if target was reached using exact position match (consistent with bot-logic.js)
            if (movementPlan.success && this.simulationState.currentTarget && 
                this.simulationState.currentPosition.x === this.simulationState.currentTarget.x &&
                this.simulationState.currentPosition.y === this.simulationState.currentTarget.y &&
                this.simulationState.currentPosition.z === this.simulationState.currentTarget.z) {
                console.log(`%c[Target Switch] Target reached (exact position match): (${this.simulationState.currentTarget.x},${this.simulationState.currentTarget.y},${this.simulationState.currentTarget.z}). Adding to previousTargets.`, 'color: #4caf50');
                this.botKnowledge.addToPreviousTargets(this.simulationState.currentTarget);
                this.simulationState.currentTarget = null;
            }
            
            if (onProgress) {
                // Pass accumulated new cells for direct visualization updates
                const newCellsForVisualization = this.simulationState.lastIterationNewCells;
                await onProgress({
                    type: 'simulation_progress',
                    ...this.botKnowledge.getExplorationState(), 
                    iteration: this.simulationState.iteration,
                    coverage: coverage,
                    currT: this.simulationState.currentTarget,
                    fronts: botDecision.frontiers || [],
                    newCells: newCellsForVisualization,
                    currPath: movementPlan.path || []
                });
            }
            
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            if (this.simulationState.betterTargetCooldown > 0) {
                this.simulationState.betterTargetCooldown--;
            }
        }
        return await this.generateFinalResults(this.simulationState);
    }

    async performSensorScanning(position, direction, range) {
        const sensorReadings = this.sensorSimulator.scan(position, range, direction);

        const updateResult = this.botKnowledge.updateFromSensorReadings(sensorReadings);

        if (updateResult.newCells.length > 0) {
            // Accumulate new cells for visualization
            this.simulationState.accumulatedNewCells.push(...updateResult.newCells);
            
            // Update component graph
            const worldProvider = this.botKnowledge.getWorldDataProvider();
            const componentProvider = this.botKnowledge.getComponentProvider();
            const componentUpdate = await this.botKnowledge.componentManager.updateComponents(
                worldProvider,
                componentProvider.getGraph(),
                componentProvider.getMaze(),
                updateResult.newCells
            );
            this.botKnowledge.componentGraph = componentUpdate.componentGraph;
            this.botKnowledge.componentColoredMaze = componentUpdate.coloredMaze;
        }
    }

    async executeMovement(movementPlan, sRange) {
        const { newPosition, newDirection } = movementPlan; 

        this.simulationState.currentPosition = newPosition;
        this.botKnowledge.updateRobotPosition(newPosition);

        if (this.simulationState.currentDirection !== newDirection) {
            await this.rotateAndSense(newPosition, this.simulationState.currentDirection, newDirection, sRange);
            this.simulationState.currentDirection = newDirection;
            this.botKnowledge.updateRobotDirection(newDirection);
        }
    }

    isPositionEqual(pos1, pos2) {
        return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
    }
    
    async generateFinalResults(simulationState) {
        const finalCoverage = this.coverageCalculator.calculate(this.botKnowledge.getWorldDataProvider());
        const explorationState = this.botKnowledge.getExplorationState();
        const discoveryStats = this.botKnowledge.getDiscoveryStats();
        
        return createStandardizedResult({
            success: true,
            coverage: finalCoverage,
            iterations: simulationState.iteration,
            explorationPath: simulationState.explorationPath,
            finalPosition: simulationState.currentPosition,
            discoveryStats: discoveryStats,
            knownMap: explorationState.knownMap3D,
            componentGraph: explorationState.graph,
            componentMaze: explorationState.cMaze3D
        });
    }
    
    async rotateAndSense(position, fromDirection, toDirection, range) {
        const rotationPath = this.botExplorer.calculateRotationPath(fromDirection, toDirection);
        let accumulatedNewCells = [];

        for (let i = 1; i < rotationPath.length; i++) {
            const scanDirection = rotationPath[i];
            const sensorReadings = this.sensorSimulator.scan(position, range, scanDirection);
            const updateResult = this.botKnowledge.updateFromSensorReadings(sensorReadings);
            if (updateResult.newCells) {
                accumulatedNewCells.push(...updateResult.newCells);
            }
        }

        if (accumulatedNewCells.length > 0) {
            // Accumulate new cells for visualization
            this.simulationState.accumulatedNewCells.push(...accumulatedNewCells);
            
            const worldProvider = this.botKnowledge.getWorldDataProvider();
            const componentProvider = this.botKnowledge.getComponentProvider();
            const componentUpdate = await this.botKnowledge.componentManager.updateComponents(
                worldProvider,
                componentProvider.getGraph(),
                componentProvider.getMaze(),
                accumulatedNewCells
            );

            this.botKnowledge.componentGraph = componentUpdate.componentGraph;
            this.botKnowledge.componentColoredMaze = componentUpdate.coloredMaze;
        }
    }
    
    getSimulationState() {
        return {
            ...this.simulationState,
            botKnowledge: this.botKnowledge.getExplorationState()
        };
    }
}

const componentExplorationAlgorithm3D = createStandardizedAlgorithm({
    name: 'Component-Based 3D Exploration (Refactored)',
    type: 'exploration',
    description: 'Refactored exploration algorithm with clean privilege boundaries',
    
    async execute(input, options = {}, onProgress = null) {
        const harness = new SimulationHarness(options);
        await harness.initialize(input, options);
        return await harness.runSimulation(input, options, onProgress);
    }
});

const compExpAlgo3D = componentExplorationAlgorithm3D;


let refactoredComponents = null;

async function loadRefactoredComponents() {
    if (refactoredComponents) return refactoredComponents;
    
    refactoredComponents = {
        refactoredAlgorithm: componentExplorationAlgorithm3D,
        SimulationHarness: SimulationHarness,
        PrivilegedWorldProvider: PrivilegedWorldProvider,
        BotKnowledgeProvider: BotKnowledgeProvider,
        PrivilegedComponentProvider: PrivilegedComponentProvider,
        DiscoveredComponentProvider: DiscoveredComponentProvider,
        CoverageCalculator: CoverageCalculator,
        CompositeMetricsCalculator: CompositeMetricsCalculator,
        BotKnowledgeManager: BotKnowledgeManager,
        BotExplorer: BotExplorer
    };
    
    return refactoredComponents;
}

console.log('✨ Using REFACTORED exploration system with privilege boundaries');

export async function createExplorationSystem(worldConfig, botConfig = {}, simulationConfig = {}) {
    const components = await loadRefactoredComponents();
    
    if (!worldConfig) {
        throw new Error('World configuration is required for exploration system');
    }
    if (!worldConfig.bounds) {
        throw new Error('World bounds are required in worldConfig');
    }
    if (!worldConfig.isWalkable && !worldConfig.world3D) {
        throw new Error('Either isWalkable function or world3D instance is required in worldConfig');
    }
    if (!botConfig.startPosition) {
        throw new Error('Bot start position is required in botConfig');
    }
    
    const harness = new components.SimulationHarness(simulationConfig);
    
    const worldSetup = {
        bounds: worldConfig.bounds,
        isWalkable: worldConfig.isWalkable,
        world3D: worldConfig.world3D
    };
    
    const botSetup = {
        startPosition: botConfig.startPosition,
        sensorRange: botConfig.sensorRange !== undefined ? botConfig.sensorRange : 15,
        ...botConfig
    };
    
    return {
        harness,
        worldConfig: worldSetup,
        botConfig: botSetup,
        
        async initialize() {
            await harness.initialize(worldSetup, botSetup);
            return this;
        },
        
        async run(input, options = {}, onProgress = null) {
            return harness.runSimulation(input, options, onProgress);
        },
        
        getState() {
            return harness.getSimulationState();
        }
    };
}

export async function createTestingEnvironment(testConfig = {}) {
    const {
        worldSize = 50,
        wallProbability = 0.2,
        startPosition,
        sensorRange = 15
    } = testConfig;
    
    const bounds = {
        minX: 0, maxX: worldSize,
        minY: 0, maxY: worldSize,
        minZ: 0, maxZ: worldSize
    };
    
    const isWalkable = (x, y, z) => {
        const noise = Math.sin(x * 0.1) * Math.cos(y * 0.1) * Math.sin(z * 0.1);
        return noise > (wallProbability * 2 - 1);
    };
    
    const worldConfig = {
        bounds,
        isWalkable,
        world3D: null
    };
    
    const botConfig = {
        startPosition: startPosition || { 
            x: Math.floor(worldSize / 2), 
            y: Math.floor(worldSize / 2), 
            z: Math.floor(worldSize / 2) 
        },
        sensorRange
    };
    
    return await createExplorationSystem(worldConfig, botConfig);
}

export async function createValidationEnvironment(validationConfig = {}) {
    const testEnv = await createTestingEnvironment(validationConfig);
    
    return {
        ...testEnv,
        
        async runValidation(input, options = {}) {
            await this.initialize();
            
            const botResults = await this.run(input, options);
            
            const harness = this.harness;
            const groundTruthAnalyzer = harness.groundTruthAnalyzer;
            
            const validationReport = {
                botResults,
                groundTruthAnalysis: groundTruthAnalyzer.getAnalysisResults(),
                comparisonMetrics: {
                    coverageEfficiency: botResults.finalCoverage,
                    pathEfficiency: botResults.metrics.pathLength || 0,
                    componentDiscovery: botResults.discoveredComponents
                }
            };
            
            return validationReport;
        }
    };
}

export async function runLegacyExploration(input, options = {}, onProgress = null) {
    if (!input) {
        throw new Error('Input configuration is required for legacy exploration');
    }
    if (!input.regionBounds) {
        throw new Error('Region bounds are required in input for legacy exploration');
    }
    if (!input.world3D) {
        throw new Error('World3D instance is required in input for legacy exploration');
    }
    if (!input.start) {
        throw new Error('Start position is required in input for legacy exploration');
    }
    
    const system = await createExplorationSystem({
        bounds: input.regionBounds,
        world3D: input.world3D
    }, {
        startPosition: input.start,
        sensorRange: options.sRange !== undefined ? options.sRange : 15
    }, options);
    
    await system.initialize();
    return system.run(input, options, onProgress);
}

const ExplorationSystemSummary = {
    interfaces: {
        WorldDataProvider: 'Abstract interface for world data access',
        ComponentProvider: 'Abstract interface for component graph access'
    },
    
    simulation: {
        WorldManager: 'Manages ground-truth world state',
        SensorSimulator: 'Simulates realistic sensor behavior',
        GroundTruthComponentAnalyzer: 'Analyzes complete component structure',
        CoverageCalculator: 'Calculates exploration coverage metrics',
        SimulationHarness: 'Main simulation orchestrator'
    },
    
    bot: {
        BotKnowledgeManager: 'Manages bot\'s discovered world knowledge',
        BotComponentManager: 'Analyzes components from bot\'s knowledge',
        BotPathfindingManager: 'Provides pathfinding using bot\'s knowledge',
        BotFrontierManager: 'Detects frontiers using bot\'s knowledge',
        BotExplorer: 'Main bot decision-making logic'
    },
    
    factories: {
        createExplorationSystem: 'Creates complete exploration system',
        createTestingEnvironment: 'Creates testing environment with mock data',
        createValidationEnvironment: 'Creates validation environment for comparison',
        runLegacyExploration: 'Backward compatibility for legacy code'
    },
    
    principles: {
        'Clean Separation': 'Privileged simulation code never directly accesses non-privileged bot code',
        'Realistic Behavior': 'Bot code operates only on discovered knowledge, no "cheating"',
        'Interface-Driven': 'All communication through well-defined interfaces',
        'Testable': 'Components can be tested independently with mock data',
        'Maintainable': 'Clear boundaries and consistent patterns'
    }
};

function useRefactoredCode() {
    console.log('✨ Switched to refactored exploration system');
}

console.log('✨ Refactored 3D Exploration System loaded successfully');
console.log('  - Clean privilege boundaries enforced');
console.log('  - Realistic bot behavior constraints implemented');
console.log('  - Comprehensive testing and validation capabilities available');

