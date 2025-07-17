

const DIRECTION_CONSTANTS = { 
    NORTH: 0, 
    NORTHEAST: 1, 
    EAST: 2, 
    SOUTHEAST: 3, 
    SOUTH: 4, 
    SOUTHWEST: 5, 
    WEST: 6, 
    NORTHWEST: 7 
};

const DIR = { 
    N: 0, NE: 1, E: 2, SE: 3, S: 4, SW: 5, W: 6, NW: 7 
};

const CELL_STATE = { 
    UNKNOWN: 2,  
    WALL: 1,     
    WALKABLE: 0  
};

export const C = { UNKNOWN: 2, WALL: 1, WALKABLE: 0 };

const DEFAULT_REGION_SIZE = 16;

export const DEF_REG_SIZE = 16;

const MAX_PREV_TARGETS_SIZE = 10;

function calculateHeuristicDistance(startPoint, endPoint, useChebyshevDistance = false) {
    const [startX, startY, startZ] = typeof startPoint === 'string' 
        ? startPoint.split(',').map(Number) 
        : [startPoint.x, startPoint.y, startPoint.z];
    
    const [endX, endY, endZ] = typeof endPoint === 'string' 
        ? endPoint.split(',').map(Number) 
        : [endPoint.x, endPoint.y, endPoint.z];
    
    const deltaX = Math.abs(startX - endX);
    const deltaY = Math.abs(startY - endY);
    const deltaZ = Math.abs(startZ - endZ);
    
    if (useChebyshevDistance) {
        return Math.max(deltaX, deltaY, deltaZ);
    } else {
        return deltaX + deltaY + deltaZ;
    }
}

const heuristic = calculateHeuristicDistance;

function generatePositionKey(cellPosition) {
    return `${cellPosition.x},${cellPosition.y},${cellPosition.z}`;
}

const getKey = generatePositionKey;

function createDeepCopyOf3DArray(sparse3DArray) {
    const copiedResult = {};
    
    for (const xCoordinate in sparse3DArray) {
        copiedResult[xCoordinate] = {};
        
        for (const yCoordinate in sparse3DArray[xCoordinate]) {
            copiedResult[xCoordinate][yCoordinate] = { ...sparse3DArray[xCoordinate][yCoordinate] };
        }
    }
    
    return copiedResult;
}

const deepCopy3DArray = createDeepCopyOf3DArray;

export const createStandardizedAlgorithm = (algorithmConfig) => ({ 
    name: algorithmConfig.name, 
    type: algorithmConfig.type, 
    description: algorithmConfig.description || '', 
    parameters: algorithmConfig.parameters || {}, 
    
    async execute(inputData, options = {}, progressCallback = null) { 
        return algorithmConfig.execute(inputData, options, progressCallback); 
    } 
});

const mkAlgo = createStandardizedAlgorithm;

export const createStandardizedResult = (algorithmResult, performanceMetrics = {}, finalStateData = null) => ({ 
    result: algorithmResult, 
    
    metrics: { 
        executionTime: 0, 
        ...performanceMetrics 
    }, 
    
    finalState: finalStateData 
});

const mkResult = createStandardizedResult;


class UnionFind {
    constructor(elementCount) {
        this.parentPointers = Array.from({ length: elementCount }, (_, index) => index); 
        
        this.subtreeRanks = new Array(elementCount).fill(0);
    }
    
    find(elementIndex) {
        return this.parentPointers[elementIndex] === elementIndex 
            ? elementIndex 
            : (this.parentPointers[elementIndex] = this.find(this.parentPointers[elementIndex]));
    }
    
    union(firstElement, secondElement) {
        let firstRoot = this.find(firstElement);
        let secondRoot = this.find(secondElement);
        
        if (firstRoot === secondRoot) return false;
        
        if (this.subtreeRanks[firstRoot] < this.subtreeRanks[secondRoot]) {
            [firstRoot, secondRoot] = [secondRoot, firstRoot];
        }
        
        this.parentPointers[secondRoot] = firstRoot; 
        
        if (this.subtreeRanks[firstRoot] === this.subtreeRanks[secondRoot]) {
            this.subtreeRanks[firstRoot]++; 
        }
        
        return true;
    }
}

const UF = UnionFind;


class WorldDataProvider {
    isWalkable(x, y, z) {
        throw new Error('isWalkable must be implemented by subclass');
    }
    
    getCellState(x, y, z) {
        throw new Error('getCellState must be implemented by subclass');
    }
    
    getBounds() {
        throw new Error('getBounds must be implemented by subclass');
    }
}

export class PrivilegedWorldProvider extends WorldDataProvider {
    constructor(world3D, regionBounds) {
        super();
        this.world3D = world3D;
        this.regionBounds = regionBounds;
    }
    
    isWalkable(x, y, z) {
        if (this.world3D && this.world3D.isWalkable) {
            return this.world3D.isWalkable(x, y, z);
        }
        return true;
    }
    
    getCellState(x, y, z) {
        return this.isWalkable(x, y, z) ? C.WALKABLE : C.WALL;
    }
    
    getBounds() {
        return this.regionBounds;
    }
}

export class BotKnowledgeProvider extends WorldDataProvider {
    constructor(knownWalkable, knownWall) {
        super();
        this.knownWalkable = knownWalkable;
        this.knownWall = knownWall;
    }
    
    isWalkable(x, y, z) {
        const key = `${x},${y},${z}`;
        return this.knownWalkable.has(key);
    }
    
    getCellState(x, y, z) {
        const key = `${x},${y},${z}`;
        if (this.knownWalkable.has(key)) {
            return C.WALKABLE;
        } else if (this.knownWall.has(key)) {
            return C.WALL;
        }
        return C.UNKNOWN;
    }
    
    getBounds() {
        // Robot doesn't know world bounds - this should not be called
        throw new Error('Bot code should not access world bounds - use privileged code instead');
    }
    
    updateKnowledge(knownWalkable, knownWall) {
        this.knownWalkable = knownWalkable;
        this.knownWall = knownWall;
    }
    
    getKnownWalkablePositions() {
        const walkablePositions = [];
        for (const key of this.knownWalkable) {
            const [x, y, z] = key.split(',').map(Number);
            walkablePositions.push({ x, y, z });
        }
        return walkablePositions;
    }
}


class BotComponentManager {
    constructor(config = {}) {
        
        this.regionSize = config.regionSize || DEF_REG_SIZE;
        this.connectivity = config.connectivity || this.getConnectivityPattern();
    }
    
    updateComponents(worldDataProvider, componentGraph, componentLookupTable, newCells) {
        
        const regionsToUpdate = this.getRegionsToUpdate(newCells);
        // Create a new ComponentGraph instance to avoid mutating the original
        const updatedGraph = new ComponentGraph();
        // Copy all nodes from the original graph
        for (const [nodeId, nodeData] of componentGraph.getAllNodes()) {
            updatedGraph.addNode(nodeId, nodeData);
        }
        const updatedLookupTable = createDeepCopyOf3DArray(componentLookupTable);

        for (const regionKey of regionsToUpdate) {
            const [regionX, regionY, regionZ] = regionKey.split(',').map(Number);
            const { worldStartX, worldStartY, worldStartZ } = this.getRegionStart(regionX, regionY, regionZ);

            this.removeOldComponents(updatedGraph, regionX, regionY, regionZ);

            this.clearRegionComponents(updatedLookupTable, { worldStartX, worldStartY, worldStartZ }, this.regionSize);

            const components = this.findComponentsInRegion(worldDataProvider, worldStartX, worldStartY, worldStartZ, this.regionSize);

            const newComponentNodes = this.createComponentNodes(components, regionX, regionY, regionZ);
            updatedGraph.addNodes(newComponentNodes);

            this.updateComponentMaze(updatedLookupTable, components);
        }

        this.resetGraphEdges(updatedGraph);
        this.detectComponentEdges(updatedGraph, worldDataProvider, updatedLookupTable);
        
        return { componentGraph: updatedGraph, coloredMaze: updatedLookupTable };
    }
    
    getRegionsToUpdate(newCells) {
        
        const regionsToUpdate = new Set();
        
        newCells.forEach(changedCell => {
            
            if (changedCell.newState === C.WALKABLE) {
                const { regionX, regionY, regionZ } = this.getRegionCoords(changedCell);
                regionsToUpdate.add(`${regionX},${regionY},${regionZ}`);
            }
        });
        
        return regionsToUpdate;
    }
    
    getRegionCoords(position) {
        
        return {
            regionX: Math.floor(position.x / this.regionSize),
            regionY: Math.floor(position.y / this.regionSize),
            regionZ: Math.floor(position.z / this.regionSize)
        };
    }
    
    getRegionStart(regionX, regionY, regionZ) {
        
        return {
            worldStartX: regionX * this.regionSize,
            worldStartY: regionY * this.regionSize,
            worldStartZ: regionZ * this.regionSize
        };
    }
    
    findComponentsInRegion(worldDataProvider, regionStartX, regionStartY, regionStartZ, regionSize) {
        
        const components = [];
        const visited = this.createVisitedArray(regionSize, regionSize, regionSize);
        
        let componentId = 0;

        for (let localX = 0; localX < regionSize; localX++) {
            for (let localY = 0; localY < regionSize; localY++) {
                for (let localZ = 0; localZ < regionSize; localZ++) {
                    const worldX = regionStartX + localX;
                    const worldY = regionStartY + localY;
                    const worldZ = regionStartZ + localZ;

                    if (!visited[localX][localY][localZ] && worldDataProvider.isWalkable(worldX, worldY, worldZ)) {

                        components[componentId] = [];

                        this.floodFill3D(
                            localX, localY, localZ,
                            regionSize, regionSize, regionSize,
                            worldDataProvider, visited, componentId, components,
                            regionStartX, regionStartY, regionStartZ
                        );
                        
                        componentId++;
                    }
                }
            }
        }
        
        return components;
    }
    
    createVisitedArray(sizeX, sizeY, sizeZ) {
        
        return Array(sizeX).fill(null).map(() => 
            Array(sizeY).fill(null).map(() => 
                Array(sizeZ).fill(false)
            )
        );
    }
    
    floodFill3D(startX, startY, startZ, regionSizeX, regionSizeY, regionSizeZ, 
                worldDataProvider, visited, componentId, components, 
                worldStartX, worldStartY, worldStartZ) {
        
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

            if (!worldDataProvider.isWalkable(worldX, worldY, worldZ)) return;

            visited[localX][localY][localZ] = true;
            components[currentComponentId].push({ x: worldX, y: worldY, z: worldZ });

            for (const [deltaX, deltaY, deltaZ] of this.connectivity) {
                floodFillInner(localX + deltaX, localY + deltaY, localZ + deltaZ, currentComponentId);
            }
        };

        floodFillInner(startX, startY, startZ, componentId);
    }
    
    getConnectivityPattern() {
        
        const pattern = [];
        for (let deltaX = -1; deltaX <= 1; deltaX++) {
            for (let deltaY = -1; deltaY <= 1; deltaY++) {
                for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
                    
                    if (deltaX === 0 && deltaY === 0 && deltaZ === 0) continue;
                    pattern.push([deltaX, deltaY, deltaZ]);
                }
            }
        }
        return pattern;
    }
    
    createComponentNodes(components, regionX, regionY, regionZ) {
        
        const componentNodes = {};
        
        components.forEach((component, localComponentId) => {
            
            if (component.length === 0) return;

            const globalNodeId = `${regionX},${regionY},${regionZ}_${localComponentId}`;
            
            componentNodes[globalNodeId] = {
                regionX, regionY, regionZ, 
                localComponentId,
                cells: component,
                neighbors: [],        
                transitions: []       
            };
        });
        
        return componentNodes;
    }
    
    updateComponentMaze(componentLookupTable, components) {
        
        components.forEach((component, localComponentId) => {
            
            if (component.length === 0) return;

            component.forEach(cell => {
                
                if (!componentLookupTable[cell.x]) componentLookupTable[cell.x] = {};
                if (!componentLookupTable[cell.x][cell.y]) componentLookupTable[cell.x][cell.y] = {};
                componentLookupTable[cell.x][cell.y][cell.z] = localComponentId;
            });
        });
    }
    
    removeOldComponents(componentGraph, regionX, regionY, regionZ) {
        
        const regionPrefix = `${regionX},${regionY},${regionZ}_`;
        componentGraph.removeNodesWithPrefix(regionPrefix);
    }
    
    clearRegionComponents(componentLookupTable, regionStart, regionSize) {
        
        const { worldStartX, worldStartY, worldStartZ } = regionStart;
        
        for (let worldX = worldStartX; worldX < worldStartX + regionSize; worldX++) {
            for (let worldY = worldStartY; worldY < worldStartY + regionSize; worldY++) {
                for (let worldZ = worldStartZ; worldZ < worldStartZ + regionSize; worldZ++) {
                    if (componentLookupTable[worldX] && 
                        componentLookupTable[worldX][worldY] && 
                        componentLookupTable[worldX][worldY][worldZ] !== undefined) {
                        
                        componentLookupTable[worldX][worldY][worldZ] = -1;
                    }
                }
            }
        }
    }
    
    resetGraphEdges(componentGraph) {
        componentGraph.resetAllEdges();
    }
    
    detectComponentEdges(componentGraph, worldDataProvider, componentLookupTable) {
        
        const processedPositions = new Set();

        for (const [componentId, componentNode] of componentGraph.getAllNodes()) {
            
            for (const cell of componentNode.cells) {
                const positionKey = `${cell.x},${cell.y},${cell.z}`;
                if (processedPositions.has(positionKey)) continue;
                processedPositions.add(positionKey);

                if (!worldDataProvider.isWalkable(cell.x, cell.y, cell.z)) continue;

                for (const [deltaX, deltaY, deltaZ] of this.connectivity) {
                    const neighborPosition = {
                        x: cell.x + deltaX,
                        y: cell.y + deltaY,
                        z: cell.z + deltaZ
                    };

                    if (worldDataProvider.isWalkable(neighborPosition.x, neighborPosition.y, neighborPosition.z)) {
                        
                        if (this.areDifferentRegions(cell, neighborPosition)) {
                            const currentComponentId = this.getComponentIdFromMaze(cell, componentLookupTable);
                            const neighborComponentId = this.getComponentIdFromMaze(neighborPosition, componentLookupTable);

                            if (currentComponentId && neighborComponentId && currentComponentId !== neighborComponentId) {
                                this.addBidirectionalEdge(componentGraph, currentComponentId, neighborComponentId, cell, neighborPosition);
                            }
                        }
                    }
                }
            }
        }
    }
    
    areDifferentRegions(pos1, pos2) {
        
        const region1 = this.getRegionCoords(pos1);
        const region2 = this.getRegionCoords(pos2);
        
        return region1.regionX !== region2.regionX || 
               region1.regionY !== region2.regionY || 
               region1.regionZ !== region2.regionZ;
    }
    
    getComponentIdFromMaze(position, componentLookupTable) {
        
        const { regionX, regionY, regionZ } = this.getRegionCoords(position);

        if (!componentLookupTable[position.x] || 
            !componentLookupTable[position.x][position.y] || 
            componentLookupTable[position.x][position.y][position.z] === undefined) {
            return null;
        }
        
        const localComponentId = componentLookupTable[position.x][position.y][position.z];
        
        return localComponentId === -1 ? null : `${regionX},${regionY},${regionZ}_${localComponentId}`;
    }
    
    addBidirectionalEdge(componentGraph, componentId1, componentId2, fromCell, toCell) {

        if (!componentGraph.hasNode(componentId1) || !componentGraph.hasNode(componentId2)) return;

        const transitionData = {
            fromCell: fromCell,
            toCell: toCell
        };
        
        componentGraph.addEdge(componentId1, componentId2, transitionData);
    }
}

export function getCompId3D(worldPosition, componentLookupTable, regionSize) { 
    const regionX = Math.floor(worldPosition.x / regionSize);
    const regionY = Math.floor(worldPosition.y / regionSize);
    const regionZ = Math.floor(worldPosition.z / regionSize); 

    if (!componentLookupTable[worldPosition.x] || 
        !componentLookupTable[worldPosition.x][worldPosition.y] || 
        componentLookupTable[worldPosition.x][worldPosition.y][worldPosition.z] === undefined) {
        return null;
    }
    
    const localComponentId = componentLookupTable[worldPosition.x][worldPosition.y][worldPosition.z]; 
    
    return localComponentId === -1 ? null : `${regionX},${regionY},${regionZ}_${localComponentId}`; 
}


class ComponentProvider {
    getGraph() {
        throw new Error('getGraph must be implemented by subclass');
    }
    
    getMaze() {
        throw new Error('getMaze must be implemented by subclass');
    }
    
    getComponentId(position) {
        throw new Error('getComponentId must be implemented by subclass');
    }
    
    hasComponent(componentId) {
        return this.getGraph().hasOwnProperty(componentId);
    }
    
    getComponentData(componentId) {
        return this.getGraph()[componentId] || null;
    }
    
    getComponentNeighbors(componentId) {
        const componentData = this.getComponentData(componentId);
        return componentData ? componentData.neighbors || [] : [];
    }
    
    getComponentTransitions(componentId) {
        const componentData = this.getComponentData(componentId);
        return componentData ? componentData.transitions || [] : [];
    }
}

export class PrivilegedComponentProvider extends ComponentProvider {
    constructor(completeComponentGraph, completeComponentLookupTable) {
        super();
        this.completeComponentGraph = completeComponentGraph;
        this.completeComponentLookupTable = completeComponentLookupTable;
    }
    
    getGraph() {
        return this.completeComponentGraph;
    }
    
    getMaze() {
        return this.completeComponentLookupTable;
    }
    
    getComponentId(position) {
        return getCompId3D(position, this.completeComponentLookupTable, DEF_REG_SIZE);
    }
    
    updateComponents(newComponentGraph, newComponentLookupTable) {
        this.completeComponentGraph = newComponentGraph;
        this.completeComponentLookupTable = newComponentLookupTable;
    }
}

export class DiscoveredComponentProvider extends ComponentProvider {
    constructor(botKnowledgeManager) {
        super();
        this.botKnowledgeManager = botKnowledgeManager;
    }
    
    getGraph() {
        return this.botKnowledgeManager.componentGraph;
    }
    
    getMaze() {
        return this.botKnowledgeManager.componentColoredMaze;
    }
    
    getComponentId(position) {
        return getCompId3D(position, this.botKnowledgeManager.componentColoredMaze, DEF_REG_SIZE);
    }
    
    updateExplorationState(newExplorationState) {
        this.explorationState = newExplorationState;
    }
    
    getExplorationState() {
        return this.explorationState;
    }
}

class TerrainKnowledgeMap {
    constructor() {
        this.terrainStates = new Map(); // key: "x,y,z", value: C.WALKABLE or C.WALL
        this.walkableCount = 0;
        this.wallCount = 0;
        this.knownWalkable = new Set();
        this.knownWall = new Set();
    }
    
    getKnownState(x, y, z) {
        const key = `${x},${y},${z}`;
        return this.terrainStates.get(key) || C.UNKNOWN;
    }
    
    updateFromSensorReadings(sensorReadings) {
        const newTerrainStates = new Map(this.terrainStates);
        const newKnownWalkable = new Set(this.knownWalkable);
        const newKnownWall = new Set(this.knownWall);
        const newlyDiscoveredCells = [];
        let newWalkableCount = this.walkableCount;
        let newWallCount = this.wallCount;

        for (const sensorReading of sensorReadings) {
            const { x, y, z, state } = sensorReading;
            const key = `${x},${y},${z}`;
            const wasUnknownCell = !this.terrainStates.has(key);
            
            if (wasUnknownCell) {
                if (state === C.WALKABLE) {
                    newTerrainStates.set(key, state);
                    newKnownWalkable.add(key);
                    newWalkableCount++;
                    newlyDiscoveredCells.push({ x, y, z, newState: state });
                } else if (state === C.WALL) {
                    newTerrainStates.set(key, state);
                    newKnownWall.add(key);
                    newWallCount++;
                    newlyDiscoveredCells.push({ x, y, z, newState: state });
                }
            }
        }
        
        this.terrainStates = newTerrainStates;
        this.walkableCount = newWalkableCount;
        this.wallCount = newWallCount;
        this.knownWalkable = newKnownWalkable;
        this.knownWall = newKnownWall;
        return { terrainStates: this.terrainStates, newCells: newlyDiscoveredCells, knownWalkable: newKnownWalkable, knownWall: newKnownWall };
    }
    
    isPositionKnown(x, y, z) {
        const key = `${x},${y},${z}`;
        return this.terrainStates.has(key);
    }
    
    isPositionWalkable(x, y, z) {
        const key = `${x},${y},${z}`;
        return this.knownWalkable.has(key);
    }
    
    getKnownWalkablePositions() {
        const walkablePositions = [];
        for (const key of this.knownWalkable) {
            const [x, y, z] = key.split(',').map(Number);
            walkablePositions.push({ x, y, z });
        }
        return walkablePositions;
    }
    
    reset() {
        this.terrainStates.clear();
        this.knownWalkable.clear();
        this.knownWall.clear();
        this.walkableCount = 0;
        this.wallCount = 0;
    }
    
    createSnapshot() {
        return {
            terrainStates: new Map(this.terrainStates),
            walkableCount: this.walkableCount,
            wallCount: this.wallCount,
            knownWalkable: new Set(this.knownWalkable),
            knownWall: new Set(this.knownWall)
        };
    }
    
    getDiscoveryStats() {
        const knownCells = this.terrainStates.size;
        const walkableCells = this.walkableCount;
        const wallCells = this.wallCount;
        
        return {
            knownCells,
            walkableCells,
            wallCells,
            // No totalCells - robot doesn't know world size!
            walkablePercentage: knownCells > 0 ? (walkableCells / knownCells) * 100 : 0
        };
    }
    
    // For compatibility with existing BotKnowledgeProvider
    getCompatibilityData() {
        
        
        
        
        return { knownWalkable: this.knownWalkable, knownWall: this.knownWall };
    }
}

class ComponentGraph {
    constructor() {
        this.nodes = new Map(); // nodeId -> component node
    }
    
    addNode(nodeId, nodeData) {
        this.nodes.set(nodeId, {
            regionX: nodeData.regionX,
            regionY: nodeData.regionY,
            regionZ: nodeData.regionZ,
            localComponentId: nodeData.localComponentId,
            cells: [...nodeData.cells], // shallow copy array
            neighbors: [...(nodeData.neighbors || [])],
            transitions: [...(nodeData.transitions || [])]
        });
    }
    
    removeNode(nodeId) {
        // Remove the node and clean up references in other nodes
        this.nodes.delete(nodeId);
        
        // Remove this node from all neighbors' neighbor lists
        for (const [otherNodeId, otherNode] of this.nodes) {
            otherNode.neighbors = otherNode.neighbors.filter(id => id !== nodeId);
            otherNode.transitions = otherNode.transitions.filter(t => t.to !== nodeId && t.from !== nodeId);
        }
    }
    
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }
    
    hasNode(nodeId) {
        return this.nodes.has(nodeId);
    }
    
    addEdge(fromNodeId, toNodeId, transitionData = null) {
        const fromNode = this.nodes.get(fromNodeId);
        const toNode = this.nodes.get(toNodeId);
        
        if (!fromNode || !toNode) return;
        
        // Add to neighbors if not already present
        if (!fromNode.neighbors.includes(toNodeId)) {
            fromNode.neighbors.push(toNodeId);
        }
        if (!toNode.neighbors.includes(fromNodeId)) {
            toNode.neighbors.push(fromNodeId);
        }
        
        // Add transition data if provided
        if (transitionData) {
            fromNode.transitions.push({ ...transitionData, to: toNodeId });
            toNode.transitions.push({ ...transitionData, from: fromNodeId });
        }
    }
    
    removeNodesWithPrefix(prefix) {
        const nodeIdsToRemove = [];
        for (const nodeId of this.nodes.keys()) {
            if (nodeId.startsWith(prefix)) {
                nodeIdsToRemove.push(nodeId);
            }
        }
        
        for (const nodeId of nodeIdsToRemove) {
            this.removeNode(nodeId);
        }
    }
    
    resetAllEdges() {
        for (const node of this.nodes.values()) {
            node.neighbors = [];
            node.transitions = [];
        }
    }
    
    getAllNodes() {
        return Array.from(this.nodes.entries());
    }
    
    createSnapshot() {
        const clonedGraph = {};
        for (const [nodeId, node] of this.nodes) {
            clonedGraph[nodeId] = {
                regionX: node.regionX,
                regionY: node.regionY,
                regionZ: node.regionZ,
                localComponentId: node.localComponentId,
                cells: node.cells.map(cell => ({ ...cell })), // clone cell objects
                neighbors: [...node.neighbors], // clone array
                transitions: node.transitions.map(t => ({ ...t })) // clone transition objects
            };
        }
        return clonedGraph;
    }
    
    // For compatibility with existing code that expects plain object
    getCompatibilityObject() {
        return this.createSnapshot();
    }
    
    // Bulk operations for efficiency
    addNodes(nodesObject) {
        for (const [nodeId, nodeData] of Object.entries(nodesObject)) {
            this.addNode(nodeId, nodeData);
        }
    }
    
    clear() {
        this.nodes.clear();
    }
    
    size() {
        return this.nodes.size;
    }
}


export class BotKnowledgeManager {
    constructor(startPosition) {
        
        this.robotPosition = { ...startPosition };
        this.robotDirection = 0; 

        this.terrainKnowledge = new TerrainKnowledgeMap();
        // Add starting position as walkable to terrain knowledge
        this.terrainKnowledge.updateFromSensorReadings([{
            x: startPosition.x,
            y: startPosition.y,
            z: startPosition.z,
            state: C.WALKABLE
        }]);
        
        this.explorationPath = [{ ...startPosition }]; 
        this.iterationCount = 0; 
        this.lastTarget = null; 
        this.sameTargetCount = 0; 
        this.currentTarget = { ...startPosition}; 
        this.previousTargets = []; 
        

        this.componentManager = new BotComponentManager();
        this.componentGraph = new ComponentGraph(); 
        this.componentColoredMaze = {};
        
        // Initialize component structure with starting position
        const initialComponentUpdate = this.componentManager.updateComponents(
            this.getWorldDataProvider(),
            this.componentGraph,
            this.componentColoredMaze,
            [{ x: startPosition.x, y: startPosition.y, z: startPosition.z, newState: C.WALKABLE }]
        );
        this.componentGraph = initialComponentUpdate.componentGraph;
        this.componentColoredMaze = initialComponentUpdate.coloredMaze; 
    }
    
    updateFromSensorReadings(sensorReadings) {
        return this.terrainKnowledge.updateFromSensorReadings(sensorReadings);
    }
    
    getKnownState(x, y, z) {
        return this.terrainKnowledge.getKnownState(x, y, z);
    }
    
    updateRobotPosition(newPosition) {
        this.robotPosition = { ...newPosition };

        this.explorationPath.push({ ...newPosition });

    }

    updateRobotDirection(newDirection) {
        this.robotDirection = newDirection;
    }
    
    updateTargetTracking(currentTarget, previousTargets) {
        
        this.currentTarget = currentTarget;
        this.previousTargets = [...previousTargets];

        if (this.previousTargets.length > 5) {
            this.previousTargets.shift();
        }
    }

    addToPreviousTargets(target) {
        // Add target to previousTargets if it's not already there
        if (!this.previousTargets.some(t => 
            t.x === target.x && t.y === target.y && t.z === target.z)) {
            this.previousTargets.push(target);
            
            // Keep the list size consistent
            if (this.previousTargets.length > MAX_PREV_TARGETS_SIZE) {
                this.previousTargets.shift();
            }
        }
    }
    
    getWorldDataProvider() {
        const { knownWalkable, knownWall } = this.terrainKnowledge.getCompatibilityData();
        return new BotKnowledgeProvider(knownWalkable, knownWall);
    }
    
    getComponentProvider() {
        
        return new DiscoveredComponentProvider(this);
    }
    
    getExplorationState() {
        
        return {
            robotPosition: this.robotPosition,
            robotDirection: this.robotDirection,
            knownMap3D: this.terrainKnowledge.getCompatibilityData(),
            componentColoredMaze: this.componentColoredMaze,
            componentGraph: this.componentGraph,
            explorationPath: this.explorationPath,
            iteration: this.iterationCount,
            lastTarget: this.lastTarget,
            sameTargetCount: this.sameTargetCount,
            currentTarget: this.currentTarget,
            previousTargets: [...this.previousTargets],
            
        };
    }
    
    getExplorationPath() {
        return [...this.explorationPath];
    }
    
    getRobotPosition() {
        return { ...this.robotPosition };
    }
    
    getRobotDirection() {
        return this.robotDirection;
    }
    
    getDiscoveryStats() {
        return this.terrainKnowledge.getDiscoveryStats();
    }
    
    isPositionKnown(x, y, z) {
        return this.terrainKnowledge.isPositionKnown(x, y, z);
    }
    
    isPositionWalkable(x, y, z) {
        return this.terrainKnowledge.isPositionWalkable(x, y, z);
    }
    
    getKnownWalkablePositions() {
        return this.terrainKnowledge.getKnownWalkablePositions();
    }
    
    reset() {
        this.terrainKnowledge.reset();
        this.componentGraph.clear();
        this.componentColoredMaze = {};
        this.explorationPath = [{ ...this.robotPosition }];
        this.iterationCount = 0;
        this.lastTarget = null;
        this.sameTargetCount = 0;
        this.currentTarget = { ...this.robotPosition};
        this.previousTargets = [];
        
    }
    
    createSnapshot() {
        
        return {
            terrainKnowledge: this.terrainKnowledge.createSnapshot(),
            componentGraph: this.componentGraph.createSnapshot(),
            componentColoredMaze: createDeepCopyOf3DArray(this.componentColoredMaze),
            robotPosition: { ...this.robotPosition },
            robotDirection: this.robotDirection,
            explorationPath: [...this.explorationPath],
            iterationCount: this.iterationCount,
            lastTarget: this.lastTarget ? { ...this.lastTarget } : null,
            sameTargetCount: this.sameTargetCount,
            currentTarget: this.currentTarget ? { ...this.currentTarget } : null,
            previousTargets: [...this.previousTargets],
            
        };
    }
}


class BotPathfindingManager {

    getMovementDirections(movementMode = 'all') {
        
        const MOVEMENT_DIRECTIONS = {
            BASIC: [
                [1, 0, 0, 1], [-1, 0, 0, 1],   
                [0, 1, 0, 1], [0, -1, 0, 1],   
                [0, 0, 1, 1], [0, 0, -1, 1]    
            ],
            DIAGONAL: [
                [1, 1, 0, 1.414], [1, -1, 0, 1.414], [-1, 1, 0, 1.414], [-1, -1, 0, 1.414],
                [1, 0, 1, 1.414], [1, 0, -1, 1.414], [-1, 0, 1, 1.414], [-1, 0, -1, 1.414],
                [0, 1, 1, 1.414], [0, 1, -1, 1.414], [0, -1, 1, 1.414], [0, -1, -1, 1.414]
            ],
            FULL_3D: [
                [1, 1, 1, 1.732], [1, 1, -1, 1.732], [1, -1, 1, 1.732], [1, -1, -1, 1.732],
                [-1, 1, 1, 1.732], [-1, 1, -1, 1.732], [-1, -1, 1, 1.732], [-1, -1, -1, 1.732]
            ]
        };

        switch (movementMode) {
            case 'basic': 
                return MOVEMENT_DIRECTIONS.BASIC;
            case 'diagonal': 
                return [...MOVEMENT_DIRECTIONS.BASIC, ...MOVEMENT_DIRECTIONS.DIAGONAL];
            case 'all': 
                return [...MOVEMENT_DIRECTIONS.BASIC, ...MOVEMENT_DIRECTIONS.DIAGONAL, ...MOVEMENT_DIRECTIONS.FULL_3D];
            default: 
                return movementMode;
        }
    }
    
    aStar(options) {
        const {
            start,
            goal,
            getNeighbors,
            heuristicFn,
            isGoal,
            getKey: keyGenerationFn = getKey
        } = options;
        
        const openList = [start];
        const parentMap = {};
        const actualCostFromStart = { [keyGenerationFn(start)]: 0 };
        const totalEstimatedCost = { [keyGenerationFn(start)]: heuristicFn(start, goal) };
        
        while (openList.length > 0) {
            const currentNode = openList.reduce((minNode, node) => 
                (totalEstimatedCost[keyGenerationFn(node)] < totalEstimatedCost[keyGenerationFn(minNode)] ? node : minNode), 
                openList[0]
            );
            
            if (isGoal(currentNode, goal)) {
                return this.reconstructPath(parentMap, currentNode, keyGenerationFn, actualCostFromStart[keyGenerationFn(currentNode)]);
            }
            
            openList.splice(openList.findIndex(node => keyGenerationFn(node) === keyGenerationFn(currentNode)), 1);
            
            for (const { neighbor, cost: edgeCost } of getNeighbors(currentNode)) {
                const tentativeActualCost = actualCostFromStart[keyGenerationFn(currentNode)] + edgeCost;
                const neighborKey = keyGenerationFn(neighbor);
                
                if (actualCostFromStart[neighborKey] === undefined || tentativeActualCost < actualCostFromStart[neighborKey]) {
                    parentMap[neighborKey] = currentNode;
                    actualCostFromStart[neighborKey] = tentativeActualCost;
                    totalEstimatedCost[neighborKey] = tentativeActualCost + heuristicFn(neighbor, goal);
                    
                    if (!openList.some(node => keyGenerationFn(node) === neighborKey)) {
                        openList.push(neighbor);
                    }
                }
            }
        }
        
        return { path: null, cost: Infinity };
    }
    
    reconstructPath(parentMap, finalNode, keyFn, actualCost = null) {
        const completePath = [];
        let currentNode = finalNode;
        
        while (currentNode) {
            completePath.unshift(currentNode);
            currentNode = parentMap[keyFn(currentNode)];
        }
        
        return { path: completePath, cost: actualCost !== null ? actualCost : completePath.length };
    }
    
    findAbstractPath(startComponentId, endComponentId, componentProvider) {
        const componentHeuristic = (fromComponentId, toComponentId) => 
            heuristic(fromComponentId.split('_')[0], toComponentId.split('_')[0]);
        
        const componentGraph = componentProvider.getGraph();
        
        if (!componentGraph.hasNode(startComponentId) || !componentGraph.hasNode(endComponentId)) {
            return { path: null, cost: Infinity };
        }
        
        if (startComponentId === endComponentId) {
            return { path: [startComponentId], cost: 0 };
        }
        
        return this.aStar({
            start: startComponentId,
            goal: endComponentId,
            getNeighbors: (currentComponentId) => 
                componentGraph.getNode(currentComponentId).neighbors.map(neighborId => ({ 
                    neighbor: neighborId, 
                    cost: 1
                })),
            heuristicFn: componentHeuristic,
            isGoal: (currentId, goalId) => currentId === goalId,
            getKey: (componentId) => componentId
        });
    }
    
    findPathInComponent(startPosition, endPosition, worldDataProvider, componentCells, options = {}) {
        const {
            hType = 'manhattan',
            movementDirs = 'all'
        } = options;
        
        const heuristicFunction = (positionA, positionB) => 
            heuristic(positionA, positionB, hType === 'chebyshev');
        
        const validComponentCells = new Set(componentCells.map(cell => `${cell.x},${cell.y},${cell.z}`));
        const movementDirections = this.getMovementDirections(movementDirs);
        
        if (!validComponentCells.has(getKey(startPosition))) {
            return { path: null, actualEnd: null };
        }
        
        let actualEndPosition = endPosition;
        if (!validComponentCells.has(getKey(endPosition))) {
            actualEndPosition = this.findNearestValidCell(endPosition, componentCells);
        }
        
        const pathfindingResult = this.aStar({
            start: startPosition,
            goal: actualEndPosition,
            getNeighbors: (currentPosition) => {
                const availableNeighbors = [];
                
                for (const [deltaX, deltaY, deltaZ, movementCost] of movementDirections) {
                    const neighborPosition = { 
                        x: currentPosition.x + deltaX, 
                        y: currentPosition.y + deltaY, 
                        z: currentPosition.z + deltaZ 
                    };
                    const neighborKey = getKey(neighborPosition);
                    
                    if (worldDataProvider.isWalkable(neighborPosition.x, neighborPosition.y, neighborPosition.z) && 
                        validComponentCells.has(neighborKey)) {
                        availableNeighbors.push({ neighbor: neighborPosition, cost: movementCost });
                    }
                }
                return availableNeighbors;
            },
            heuristicFn: heuristicFunction,
            isGoal: (currentPos, goalPos) => 
                currentPos.x === goalPos.x && currentPos.y === goalPos.y && currentPos.z === goalPos.z
        });
        
        return { 
            path: pathfindingResult.path, 
            actualEnd: pathfindingResult.path ? actualEndPosition : null,
            cost: pathfindingResult.cost
        };
    }
    
    findNearestValidCell(targetPosition, componentCells) {
        let minimumDistance = Infinity;
        let nearestCell = null;
        
        for (const candidateCell of componentCells) {
            const distanceToTarget = heuristic(candidateCell, targetPosition);
            if (distanceToTarget < minimumDistance) {
                minimumDistance = distanceToTarget;
                nearestCell = candidateCell;
            }
        }
        
        return nearestCell;
    }
    
    buildDetailedPath(abstractPath, startPosition, endPosition, worldDataProvider, componentProvider, options = {}) {
        const completeDetailedPath = [];
        let currentPosition = startPosition;
        let actualFinalEnd = endPosition;
        let totalCost = 0;
        const componentGraph = componentProvider.getGraph();
        
        for (let componentIndex = 0; componentIndex < abstractPath.length; componentIndex++) {
            const currentComponentId = abstractPath[componentIndex];
            const currentComponent = componentGraph.getNode(currentComponentId);
            let segmentPathResult;
            
            if (componentIndex === abstractPath.length - 1) {
                segmentPathResult = this.findPathInComponent(
                    currentPosition, 
                    endPosition, 
                    worldDataProvider, 
                    currentComponent.cells, 
                    options
                );
            } else {
                const nextComponentId = abstractPath[componentIndex + 1];
                const exitTransition = currentComponent.transitions.find(transition => transition.to === nextComponentId);
                
                if (!exitTransition) {
                    return { path: null, actualEnd: null, cost: 0 };
                }
                
                segmentPathResult = this.findPathInComponent(
                    currentPosition, 
                    exitTransition.fromCell, 
                    worldDataProvider, 
                    currentComponent.cells, 
                    options
                );
            }
            
            if (!segmentPathResult?.path?.length) {
                return { path: null, actualEnd: null, cost: 0 };
            }
            
            // Add segment cost to total
            if (segmentPathResult.cost !== undefined) {
                totalCost += segmentPathResult.cost;
            } else {
                // Fallback: calculate cost based on path length
                totalCost += segmentPathResult.path.length - 1;
            }
            
            const segmentStartIndex = this.shouldSkipFirstNode(completeDetailedPath, segmentPathResult.path) ? 1 : 0;
            completeDetailedPath.push(...segmentPathResult.path.slice(segmentStartIndex));
            
            if (componentIndex < abstractPath.length - 1) {
                const exitTransition = currentComponent.transitions.find(transition => transition.to === abstractPath[componentIndex + 1]);
                currentPosition = exitTransition.toCell;
                
                if (!this.isPositionEqual(completeDetailedPath[completeDetailedPath.length - 1], currentPosition)) {
                    completeDetailedPath.push(currentPosition);
                }
            } else {
                actualFinalEnd = segmentPathResult.actualEnd;
            }
        }
        
        return { path: completeDetailedPath, actualEnd: actualFinalEnd, cost: totalCost };
    }
    
    shouldSkipFirstNode(existingPath, newSegment) {
        return existingPath.length > 0 && 
               newSegment.length > 0 && 
               this.isPositionEqual(existingPath[existingPath.length - 1], newSegment[0]);
    }
    
    isPositionEqual(pos1, pos2) {
        return pos1.x === pos2.x && 
               pos1.y === pos2.y && 
               pos1.z === pos2.z;
    }
    
    findHierarchicalPath(startPosition, endPosition, worldDataProvider, componentProvider, options = {}) {
        const {
            hType = 'manhattan',
            costOnly = false
        } = options;
        
        const startComponentId = componentProvider.getComponentId(startPosition);
        const endComponentId = componentProvider.getComponentId(endPosition);
        
        if (!startComponentId || !endComponentId) {
            const componentMaze = componentProvider.getMaze();
            const startTerrainState = worldDataProvider.getCellState(startPosition.x, startPosition.y, startPosition.z);
            const endTerrainState = worldDataProvider.getCellState(endPosition.x, endPosition.y, endPosition.z);
            
            // Get maze values at positions
            const startMazeValue = componentMaze?.[startPosition.x]?.[startPosition.y]?.[startPosition.z];
            const endMazeValue = componentMaze?.[endPosition.x]?.[endPosition.y]?.[endPosition.z];
            
            // Check nearby positions for context
            const nearbyPositions = [];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        const nearbyPos = { x: endPosition.x + dx, y: endPosition.y + dy, z: endPosition.z + dz };
                        const nearbyComponentId = componentProvider.getComponentId(nearbyPos);
                        const nearbyTerrainState = worldDataProvider.getCellState(nearbyPos.x, nearbyPos.y, nearbyPos.z);
                        if (nearbyComponentId || nearbyTerrainState !== C.UNKNOWN) {
                            nearbyPositions.push({
                                pos: nearbyPos,
                                componentId: nearbyComponentId,
                                terrainState: nearbyTerrainState
                            });
                        }
                    }
                }
            }
            
            if (!startComponentId) {
                throw new Error(`Component ID lookup failed for start position (${startPosition.x},${startPosition.y},${startPosition.z}). Start terrain state: ${startTerrainState}, maze value: ${startMazeValue}. This indicates the position is not in any walkable component or the component maze is corrupted.`);
            }
            
            if (!endComponentId) {
                throw new Error(`Component ID lookup failed for end position (${endPosition.x},${endPosition.y},${endPosition.z}). End terrain state: ${endTerrainState}, maze value: ${endMazeValue}. Start position: (${startPosition.x},${startPosition.y},${startPosition.z}), start component: ${startComponentId}. Nearby positions with components: ${nearbyPositions.map(p => `(${p.pos.x},${p.pos.y},${p.pos.z}):${p.componentId}:${p.terrainState}`).join(', ')}. This indicates the frontier position is not in any walkable component.`);
            }
        }
        
        const abstractPathResult = this.findAbstractPath(startComponentId, endComponentId, componentProvider);
        const abstractPath = abstractPathResult.path;
        
        if (!abstractPath) {
            throw new Error(`Abstract pathfinding failed between components ${startComponentId} and ${endComponentId}. This indicates the components are not connected in the component graph.`);
        }
        
        if (costOnly) {
            return { 
                abstractPath: abstractPath, 
                detailedPath: null, 
                abstractCost: abstractPathResult.cost 
            };
        }
        
        const detailedPathResult = this.buildDetailedPath(abstractPath, startPosition, endPosition, worldDataProvider, componentProvider, options);
        
        if (!detailedPathResult.path) {
            throw new Error(`Detailed pathfinding failed within components. Abstract path: ${abstractPath.join(' -> ')}. This indicates internal component pathfinding is broken.`);
        }
        
        return {
            abstractPath: abstractPath,
            detailedPath: detailedPathResult.path,
            actualEnd: detailedPathResult.actualEnd,
            cost: detailedPathResult.cost
        };
    }
    
    findPath(startPosition, endPosition, worldDataProvider, componentProvider, options = {}) {
        const { costOnly = false } = options;
        
        const pathfindingResult = this.findHierarchicalPath(
            startPosition, 
            endPosition, 
            worldDataProvider, 
            componentProvider, 
            { ...options, costOnly }
        );
        
        if (costOnly) {
            return { 
                path: null, 
                actualEnd: null, 
                abstractCost: pathfindingResult.abstractCost 
            };
        }
        
        return { 
            path: pathfindingResult.detailedPath, 
            actualEnd: pathfindingResult.actualEnd,
            cost: pathfindingResult.cost
        };
    }
}


class BotFrontierManager {
    constructor(config = {}) {
        
        this.config = config;
    }
    
    detectFrontiers(worldDataProvider) {
        
        const individualFrontierPoints = this.findFrontierPoints(worldDataProvider);
        const frontierClusters = this.groupFrontierPoints(individualFrontierPoints);
        
        return frontierClusters.map(clusterPoints => ({ 
            points: clusterPoints, 
            // centroid: this.calculateCentroid(clusterPoints), 
            // median: this.calculateMedian(clusterPoints), 
            size: clusterPoints.length 
        }));
    }
    
    findFrontierPoints(worldDataProvider) {
        
        const discoveredFrontierPoints = [];
        const bfsQueue = [];
        const processedCells = new Set();
        
        // Get all known walkable positions instead of iterating over world bounds
        const knownWalkablePositions = worldDataProvider.getKnownWalkablePositions ? 
            worldDataProvider.getKnownWalkablePositions() : [];
        
        for (const position of knownWalkablePositions) {
            bfsQueue.push(position);
        }

        while (bfsQueue.length > 0) {
            const currentCell = bfsQueue.shift();
            const cellKey = `${currentCell.x},${currentCell.y},${currentCell.z}`;
            
            if (processedCells.has(cellKey)) continue;
            processedCells.add(cellKey);
            
            let isCurrentCellFrontier = false;

            for (const neighborPosition of this.getNeighbors(currentCell)) {
                if (worldDataProvider.getCellState(neighborPosition.x, neighborPosition.y, neighborPosition.z) === C.UNKNOWN) {
                    isCurrentCellFrontier = true;
                    break;
                }
            }

            if (isCurrentCellFrontier) {
                discoveredFrontierPoints.push({ 
                    x: currentCell.x + 0.5, 
                    y: currentCell.y + 0.5, 
                    z: currentCell.z + 0.5 
                });
            }

            for (const neighborPosition of this.getNeighbors(currentCell)) {
                const neighborKey = `${neighborPosition.x},${neighborPosition.y},${neighborPosition.z}`;
                const isNeighborWalkable = worldDataProvider.getCellState(neighborPosition.x, neighborPosition.y, neighborPosition.z) === C.WALKABLE;
                const isNeighborAlreadyQueued = bfsQueue.some(queuedCell => 
                    queuedCell.x === neighborPosition.x && 
                    queuedCell.y === neighborPosition.y && 
                    queuedCell.z === neighborPosition.z
                );
                
                if (!processedCells.has(neighborKey) && isNeighborWalkable && !isNeighborAlreadyQueued) {
                    bfsQueue.push(neighborPosition);
                }
            }
        }
        
        return discoveredFrontierPoints;
    }
    
    getNeighbors(position) {
        
        const validNeighbors = [];

        for (let deltaX = -1; deltaX <= 1; deltaX++) {
            for (let deltaY = -1; deltaY <= 1; deltaY++) {
                for (let deltaZ = -1; deltaZ <= 1; deltaZ++) {
                    
                    if (deltaX === 0 && deltaY === 0 && deltaZ === 0) continue;
                    
                    const neighborX = position.x + deltaX;
                    const neighborY = position.y + deltaY;
                    const neighborZ = position.z + deltaZ;

                    // Robot doesn't know world bounds - neighbors are always valid
                    validNeighbors.push({ x: neighborX, y: neighborY, z: neighborZ });
                }
            }
        }
        
        return validNeighbors;
    }
    
    groupFrontierPoints(frontierPoints) {
        
        const visitedPointKeys = new Set();
        const frontierClusters = [];
        const CLUSTERING_DISTANCE_THRESHOLD = 3.0;
        
        for (const seedPoint of frontierPoints) {
            const seedPointKey = this.getPointKey(seedPoint);
            
            if (visitedPointKeys.has(seedPointKey)) continue;
            
            const clusterExpansionQueue = [seedPoint];
            const currentCluster = [];
            const processedInCluster = new Set();
            
            while (clusterExpansionQueue.length > 0) {
                const currentPoint = clusterExpansionQueue.shift();
                const currentPointKey = this.getPointKey(currentPoint);
                
                if (processedInCluster.has(currentPointKey)) continue;
                
                processedInCluster.add(currentPointKey);
                visitedPointKeys.add(currentPointKey);
                currentCluster.push(currentPoint);
                
                for (const candidatePoint of frontierPoints) {
                    const candidatePointKey = this.getPointKey(candidatePoint);
                    
                    if (processedInCluster.has(candidatePointKey) || visitedPointKeys.has(candidatePointKey)) continue;
                    
                    const euclideanDistance = this.calculateDistance(candidatePoint, currentPoint);
                    
                    if (euclideanDistance < CLUSTERING_DISTANCE_THRESHOLD) {
                        clusterExpansionQueue.push(candidatePoint);
                    }
                }
            }
            
            frontierClusters.push(currentCluster);
        }
        
        return frontierClusters;
    }
    
    getPointKey(point) {
        
        return `${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)}`;
    }
    
    calculateDistance(point1, point2) {
        
        return Math.sqrt(
            (point1.x - point2.x) ** 2 + 
            (point1.y - point2.y) ** 2 + 
            (point1.z - point2.z) ** 2
        );
    }
    
    
    detectComponentAwareFrontiers(worldDataProvider, componentProvider, robotPosition = null) {
        
        const basicFrontierGroups = this.detectFrontiers(worldDataProvider);
        const componentAwareFrontiers = [];
        const componentGraph = componentProvider.getGraph();
        
        for (const frontierGroup of basicFrontierGroups) {
            const componentToPointsMap = new Map();
            
            for (const frontierPoint of frontierGroup.points) {
                const discretePosition = { 
                    x: Math.floor(frontierPoint.x), 
                    y: Math.floor(frontierPoint.y), 
                    z: Math.floor(frontierPoint.z) 
                };
                
                let associatedComponentId = componentProvider.getComponentId(discretePosition);
                
                if (!associatedComponentId) {
                    associatedComponentId = this.findClosestComponent(discretePosition, componentGraph);
                }
                
                if (associatedComponentId) {
                    if (!componentToPointsMap.has(associatedComponentId)) {
                        componentToPointsMap.set(associatedComponentId, []);
                    }
                    componentToPointsMap.get(associatedComponentId).push(discretePosition);
                }
            }
            
            for (const [componentId, frontierPoints] of componentToPointsMap) {
                if (frontierPoints.length === 0) continue;
                
                const navigationTarget = this.calculateNavigationTarget(frontierPoints);
                
                if (robotPosition && heuristic(navigationTarget, robotPosition) <= 2.0) continue;
                
                componentAwareFrontiers.push({ 
                    x: navigationTarget.x, 
                    y: navigationTarget.y, 
                    z: navigationTarget.z, 
                    componentId: componentId, 
                    groupSize: frontierPoints.length, 
                    points: frontierPoints 
                });
            }
        }
        
        return componentAwareFrontiers;
    }
    
    findClosestComponent(position, componentGraph) {
        
        let closestComponentId = null;
        let shortestDistance = Infinity;
        
        for (const [componentId, componentData] of componentGraph.getAllNodes()) {
            for (const componentCell of componentData.cells) {
                const distanceToCell = heuristic(componentCell, position, true);
                if (distanceToCell < shortestDistance) {
                    shortestDistance = distanceToCell;
                    closestComponentId = componentId;
                }
            }
        }
        
        return closestComponentId;
    }
    
    calculateNavigationTarget(points) {
        return points[0];
    }
    
    filterReachableFrontiers(frontiers, robotPosition, componentProvider) {
        
        const currentRobotComponent = componentProvider.getComponentId(robotPosition);
        const componentGraph = componentProvider.getGraph();
        
        return frontiers.filter(frontier => 
            this.isComponentReachable(currentRobotComponent, frontier.componentId, componentGraph)
        );
    }
    
    isComponentReachable(startComponentId, targetComponentId, componentGraph) {
        
        if (!startComponentId || !targetComponentId) return false;
        if (startComponentId === targetComponentId) return true;
        
        const visited = new Set();
        const queue = [startComponentId];
        
        while (queue.length > 0) {
            const currentComponent = queue.shift();
            if (currentComponent === targetComponentId) return true;
            
            if (visited.has(currentComponent)) continue;
            visited.add(currentComponent);
            
            const componentData = componentGraph.getNode(currentComponent);
            if (componentData && componentData.neighbors) {
                for (const neighbor of componentData.neighbors) {
                    if (!visited.has(neighbor)) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        return false;
    }
    
    selectOptimalFrontier(frontiers, robotPosition, componentProvider, previousTargets = [], pathfindingManager = null, worldDataProvider = null, failedTargets = new Map()) {
        
        if (frontiers.length === 0) return null;

        let candidateFrontiers = frontiers.filter(f => {
            const key = `${f.x},${f.y},${f.z}`;
            const failures = failedTargets.get(key) || 0;
            return failures < 3; 
        });

        if (candidateFrontiers.length === 0 && frontiers.length > 0) {
            console.warn("All available frontiers are blacklisted. Resetting blacklist for this selection cycle.");
            candidateFrontiers = frontiers;
        }

        const currentRobotComponent = componentProvider.getComponentId(robotPosition);
        const componentGraph = componentProvider.getGraph();

        let reachableFrontiers = candidateFrontiers.filter(frontier => 
            this.isComponentReachable(currentRobotComponent, frontier.componentId, componentGraph)
        );
        
        if (reachableFrontiers.length === 0) reachableFrontiers = candidateFrontiers; 
        if (reachableFrontiers.length === 0) return null; 

        let availableFrontiers = reachableFrontiers.filter(frontier => 
            !previousTargets.some(prevTarget => 
                prevTarget && prevTarget.x === frontier.x && prevTarget.y === frontier.y && prevTarget.z === frontier.z
            )
        );
        
        if (availableFrontiers.length === 0) availableFrontiers = reachableFrontiers; 

        const sameComponentFrontiers = availableFrontiers.filter(frontier => 
            frontier.componentId === currentRobotComponent
        );
        
        if (sameComponentFrontiers.length > 0) availableFrontiers = sameComponentFrontiers; 

        if (pathfindingManager && worldDataProvider) {
            const frontiersWithPathCosts = availableFrontiers.map(frontier => {
                const pathResult = pathfindingManager.findPath(
                    robotPosition,
                    { x: frontier.x, y: frontier.y, z: frontier.z },
                    worldDataProvider,
                    componentProvider,
                    { costOnly: true }
                );
                return { 
                    ...frontier, 
                    abstractCost: pathResult?.abstractCost || Infinity 
                };
            }).filter(frontier => frontier.abstractCost !== Infinity);
            
            if (frontiersWithPathCosts.length > 0) {
                const sortedByPathCost = frontiersWithPathCosts.sort((a, b) => a.abstractCost - b.abstractCost);
                const topCandidates = sortedByPathCost.slice(0, Math.min(20, sortedByPathCost.length)); 
                
                const candidatesWithDetailedPaths = topCandidates.map(f => {
                    const detailedPathResult = pathfindingManager.findPath(robotPosition, { x: f.x, y: f.y, z: f.z }, worldDataProvider, componentProvider);
                    return { ...f, pathCost: detailedPathResult.cost !== undefined ? detailedPathResult.cost : Infinity };
                }).filter(f => f.pathCost !== Infinity);
                
                if (candidatesWithDetailedPaths.length > 0) {
                    return candidatesWithDetailedPaths.sort((a, b) => a.pathCost - b.pathCost)[0];
                }
                
                // If no detailed paths work, return best abstract candidate
                // The pathfinding system will handle the failure appropriately
                return topCandidates[0]; 
            }
        }
        const frontiersWithDistance = availableFrontiers.map(frontier => ({
            ...frontier,
            pathDist: heuristic(robotPosition, frontier)
        }));
        
        return frontiersWithDistance.sort((a, b) => a.pathDist - b.pathDist)[0];
    }
}


export class BotExplorer {
    constructor(botConfig = {}) {
        
        this.config = botConfig;
        this.frontierManager = new BotFrontierManager(botConfig);
        this.pathfindingManager = new BotPathfindingManager();
        this.explorationHistory = [];
        this.stuckPositions = [];
        
        this.explorationStats = {
            totalMoves: 0,
            uniquePositions: new Set(),
            targetsReached: 0,
            stuckEvents: 0
        };
    }
    
    async decideNextAction(state) {
        
        const { robotPosition, worldDataProvider, componentProvider, stuckCounter, currentTarget, previousTargets, failedTargets } = state;

        
        let newTarget = currentTarget;
        
        const needNewTarget = !currentTarget || this.isTargetReached(currentTarget, robotPosition);
        
        
        let shouldAddCurrentTargetToPrevious = true;
        let availableFrontiers = [];
        
        if (needNewTarget) {
            availableFrontiers = this.frontierManager.detectComponentAwareFrontiers(
                worldDataProvider,
                componentProvider,
                robotPosition
            );
            // Signal that current target should be added to previousTargets when abandoning it
            shouldAddCurrentTargetToPrevious = currentTarget && !previousTargets.some(t => 
                t && t.x === currentTarget.x && t.y === currentTarget.y && t.z === currentTarget.z
            );
            
            newTarget = this.frontierManager.selectOptimalFrontier(
                availableFrontiers,
                robotPosition,
                componentProvider,
                previousTargets || [],
                this.pathfindingManager,
                worldDataProvider,
                failedTargets
            );
            
            if (newTarget) {
                this.explorationStats.targetsReached++;
            }
        }
        
        // Log when target changes
        if (currentTarget && newTarget && 
            (currentTarget.x !== newTarget.x || currentTarget.y !== newTarget.y || currentTarget.z !== newTarget.z)) {
            console.log(`[Target Change] Switching from (${currentTarget.x},${currentTarget.y},${currentTarget.z}) to (${newTarget.x},${newTarget.y},${newTarget.z})`);
        } else if (!currentTarget && newTarget) {
            console.log(`[Target Set] New target: (${newTarget.x},${newTarget.y},${newTarget.z})`);
        } else if (currentTarget && !newTarget) {
            console.log(`[Target Cleared] Removing target: (${currentTarget.x},${currentTarget.y},${currentTarget.z})`);
        }
        
        return {
            target: newTarget,
            frontiers: availableFrontiers,
            needNewTarget,
            shouldAddCurrentTargetToPrevious,
            explorationStats: this.explorationStats
        };
    }
    

    
    isTargetReached(target, robotPosition) {
        
        return target && 
               robotPosition.x === target.x && 
               robotPosition.y === target.y && 
               robotPosition.z === target.z;
    }
    
    async checkForBetterTarget(state, frontiers, currentPathLength) {

        const { robotPosition, worldDataProvider, componentProvider, currentTarget, previousTargets } = state;

        if (!currentTarget) return null;
        if (!frontiers || frontiers.length === 0) return null;

        const availableFrontiers = frontiers.filter(f =>
            !(f.x === currentTarget.x && f.y === currentTarget.y && f.z === currentTarget.z)
        );

        if (availableFrontiers.length === 0) return null;

        const bestAlternative = this.frontierManager.selectOptimalFrontier(
            availableFrontiers, robotPosition, componentProvider, previousTargets, this.pathfindingManager, worldDataProvider
        );

        if (!bestAlternative) return null;

        const pathResult = this.pathfindingManager.findPath(robotPosition, bestAlternative, worldDataProvider, componentProvider);
        const newPathCost = pathResult.cost !== undefined ? pathResult.cost : Infinity;

        if (newPathCost < currentPathLength*0.5) {
            console.log("Switching to better target", newPathCost, currentPathLength);
            return { ...bestAlternative, pathCost: newPathCost };
        }

        return null;
    }
    
    async executeMovement(state) {
        
        const { robotPosition, robotDirection, target, worldDataProvider, componentProvider, stepSize = 1.0 } = state;

        console.log(`[Execute Movement] Called with target: (${target?.x},${target?.y},${target?.z}), robot: (${robotPosition.x},${robotPosition.y},${robotPosition.z})`);
        
        if (!target) {
            throw new Error('No target specified');
        }

        const pathResult = this.pathfindingManager.findPath(
            robotPosition,
            target,
            worldDataProvider,
            componentProvider
        );
        
        if (!pathResult?.path || pathResult.path.length === 0) {
            throw new Error(`Pathfinding returned invalid result. PathResult: ${JSON.stringify(pathResult)}. This should not happen if hierarchical pathfinding is working correctly.`);
        }

        const targetStepIndex = Math.min(Math.floor(stepSize), pathResult.path.length - 1);
        
        if (pathResult.path.length <= 1) {
            return { 
                success: true, 
                reason: 'Target reached',
                newPosition: robotPosition,
                newDirection: robotDirection,
                path: pathResult.path,
                cost: pathResult.cost
            };
        }

        const newPosition = {
            x: pathResult.path[targetStepIndex].x,
            y: pathResult.path[targetStepIndex].y,
            z: pathResult.path[targetStepIndex].z
        };

        const newDirection = this.calculateMovementDirection(robotPosition, newPosition);

        this.explorationStats.totalMoves++;
        this.explorationStats.uniquePositions.add(`${newPosition.x},${newPosition.y},${newPosition.z}`);


        
        return {
            success: true,
            newPosition,
            newDirection,
            path: pathResult.path,
            actualEnd: pathResult.actualEnd,
            cost: pathResult.cost
        };
    }
    
    calculateMovementDirection(fromPosition, toPosition) {
        
        const deltaX = toPosition.x - fromPosition.x;
        const deltaY = toPosition.y - fromPosition.y;
        const deltaZ = toPosition.z - fromPosition.z;

        if (deltaX === 0 && deltaY === 0 && deltaZ === 0) {
            return DIR.N; 
        }

        if (deltaX !== 0 && deltaZ !== 0) {
            
            if (deltaX < 0) {
                return deltaZ > 0 ? DIR.SW : DIR.NW;
            } else {
                return deltaZ > 0 ? DIR.SE : DIR.NE;
            }
        } else if (deltaX !== 0) {
            
            return deltaX < 0 ? DIR.W : DIR.E;
        } else if (deltaZ !== 0) {
            
            return deltaZ > 0 ? DIR.S : DIR.N;
        }
        
        return DIR.N; 
    }
    
    performRotation(currentDirection, targetDirection, robotPosition) {
        
        const rotationPath = this.calculateRotationPath(currentDirection, targetDirection);
        
        return {
            success: true,
            rotationPath,
            finalDirection: targetDirection,
            position: robotPosition
        };
    }
    
    calculateRotationPath(fromDirection, toDirection) {
        
        const clockwiseDistance = (toDirection - fromDirection + 8) % 8;
        const counterClockwiseDistance = (fromDirection - toDirection + 8) % 8;
        
        const rotationPath = [fromDirection];
        
        if (clockwiseDistance <= counterClockwiseDistance) {
            for (let step = 1; step <= clockwiseDistance; step++) {
                rotationPath.push((fromDirection + step) % 8);
            }
        } else {
            for (let step = 1; step <= counterClockwiseDistance; step++) {
                rotationPath.push((fromDirection - step + 8) % 8);
            }
        }
        
        return rotationPath;
    }
    
    async perform360Scan(state) {
        
        const { robotPosition } = state;
        
        console.log('Performing 360-degree scan for stuck recovery');

        this.currentTarget = { ...robotPosition};
        this.explorationStats.stuckEvents++;
        
        return {
            success: true,
            position: robotPosition,
            scannedDirections: [0, 1, 2, 3, 4, 5, 6, 7]
        };
    }
    
    getExplorationStats() {
        
        return {
            ...this.explorationStats,
            uniquePositionCount: this.explorationStats.uniquePositions.size,
            currentTarget: this.currentTarget
        };
    }
    
    getExplorationState() {
        
        return {
            currentTarget: this.currentTarget,
            
            explorationStats: this.explorationStats
        };
    }
    
    reset() {
        
        this.stuckPositions = [];
        this.previousTargets = [];

        this.explorationStats = {
            totalMoves: 0,
            uniquePositions: new Set(),
            targetsReached: 0,
            stuckEvents: 0
        };
    }
    
}
