import React, { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { Eraser, Pen, Pin, ChevronLeft, ChevronRight, RefreshCw, Hand, Circle, Link } from 'lucide-react';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';
// import Timer from './Timer';

interface LogInfo {
  player_number: number,
  type: 'draw' | 'erase' | 'push' | 'refresh' | 'move_prev_level' | 'move_next_level',
  timestamp: Date,
}

const TOTAL_LEVELS = 10; // 총 스테이지 수를 정의합니다.

// 맵이 변할 때 마다 실행됨.
const PhysicsCanvas: React.FC = () => {
  const socket = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(Matter.Engine.create({
    gravity: { x: 0, y: 1, scale: 0.001 },
  }));
  const renderRef = useRef<Matter.Render | null>();
  const runnerRef = useRef<Matter.Runner | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'pin' | 'chain' | 'push'>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Matter.Vector[]>([]);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [resetTrigger, setResetTrigger] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<string>('player1');
  const [pushLock, setPushLock] = useState(false);
  const [drawLock, setDrawLock] = useState(false);
  const [completedLevels, setCompletedLevels] = useState<number[]>([]);
  // chain 이벤트가 이미 emit 되었는지 여부 플래그 (중복 방지)
  const chainEmittedRef = useRef<boolean>(false);
  
  // const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number }[]>([]);
  // const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number }[]>([]);
  const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number; timestamp: number }[]>([]);
  const CURSOR_LIFETIME = 2000; // 2초
  
  const initialBallPositionRef = useRef({ x: 0, y: 0 }); // 공 초기 위치 저장
  const mapObjects = ['ground', 'tower1', 'tower2', 'tower3', 'tower4', 'tower5', 'base', 'pedestal', 'top_bar', 'vertical_bar', 'red_box', 'left_up_green_platform', 'left_down_green_platform', 'right_up_green_platform', 'right_down_green_platform', 'left_red_wall', 'right_red_wall', 'bottom_red_wall', 'red_platform', 'green_ramp', 'central_obstacle', 'wall_bottom', 'wall_top', 'wall_left', 'wall_right', 'horizontal_platform', 'frame_top', 'frame_left', 'frame_right', 'horizontal_down_platform', 'pillar1', 'pillar2', 'pillar3', 'rounded_slope', 'horizontal_down_platform', 'horizontal_up_platform'];
  const staticObjects = ['wall', 'ball', 'balloon'].concat(mapObjects);
  const ballRef = useRef<Matter.Body | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // const [startTimer, setStartTimer] = useState<boolean>(false);
  // const [isFinished, setIsFinished] = useState<boolean>(false);

  // A list to store the selected pins
  const [selectedPins, setSelectedPins] = useState<Matter.Body[]>([]);

  // 못(nail)들을 저장하는 상태
  const [nails, setNails] = useState<Matter.Body[]>([]);
  const nailsRef = useRef<Matter.Body[]>([]);

  // nail 추가 함수
  const addNail = (nail: Matter.Body) => {
    nailsRef.current = [...nailsRef.current, nail];
    setNails(nailsRef.current); // 상태 업데이트도 유지
  };

  // nails에서 특정 nail 삭제 함수
  const removeNail = (nail: Matter.Body) => {
    nailsRef.current = nailsRef.current.filter((n) => n !== nail); // 참조값 업데이트
    setNails(nailsRef.current); // 상태 업데이트
  };

  // nails 상태 초기화 함수
  const resetNails = () => {
    nailsRef.current = []; // 참조값 초기화
    setNails([]); // 상태도 초기화
  };
  
  useEffect(() => {
    if(gameEnded) {
      socket.emit('completeLevel', {
        completedLevel: currentLevel,
        playerId: 'player1',
      });
    }
  }, [gameEnded])

  // -----------------------------------------------
  // 2) 서버에서 "completedLevelsResponse" 받기
  //    => completedLevels 업데이트
  // -----------------------------------------------
  useEffect(() => {
    // 'completedLevelsResponse' => 서버가 getCompletedLevels 요청에 대한 응답을 준다
    socket.on('completedLevelsResponse', (data: { levels: number[] }) => {
      console.log('Received completed levels:', data.levels);
      setCompletedLevels(data.levels);
    });

    // 'completedLevelsUpdated' => 누군가 completeLevel 하면,
    // 서버가 전체 클라이언트에 브로드캐스트할 수도 있음
    socket.on('completedLevelsUpdated', (data: { levels: number[] }) => {
      console.log('completedLevelsUpdated:', data.levels);
      setCompletedLevels(data.levels);
    });

    // 컴포넌트 마운트 시점에 "getCompletedLevels" 이벤트로 요청
    socket.emit('getCompletedLevels');

    return () => {
      socket.off('completedLevelsResponse');
      socket.off('completedLevelsUpdated');
    };
  }, [socket]);

  useEffect(() => {
    socket.on('createChain', (data: { playerId: string, customId: string, pinAId: string, pinBId: string, stiffness: number, damping: number, length: number, currentLevel: number }) => {
      console.log('Received createChain from server:', data);
  
      // 1) pinA, pinB를 label로 찾아서 Body 객체를 얻는다
      const pinA = Matter.Composite.allBodies(engineRef.current.world)
                     .find(b => b.label === data.pinAId);
      const pinB = Matter.Composite.allBodies(engineRef.current.world)
                     .find(b => b.label === data.pinBId);
  
      if (!pinA || !pinB) {
        console.warn('Could not find pinA or pinB in local world:', data.pinAId, data.pinBId);
        return;
      }
  
      // 2) Constraint 생성
      const chain = Matter.Constraint.create({
        bodyA: pinA,
        bodyB: pinB,
        stiffness: data.stiffness,
        damping: data.damping,
        length: data.length,
        render: {
          visible: true,
          lineWidth: 4,
          strokeStyle: '#8B0000',
        },
        label: data.customId,
      });
  
      // 3) Matter.World에 추가
      Matter.World.add(engineRef.current.world, chain);
    });
  
    return () => {
      socket.off('createChain');
    };
  }, [socket]);

  // // 타이머 시작 이벤트 처리
  // useEffect(() => {
  //   socket.on('startTimer', () => {
  //     console.log('Timer started by server');
  //     setStartTimer(true);
  //   });

  //   return () => {
  //     socket.off('startTimer');
  //   };
  // }, []);

  // const handleTimerFinish = () => {
  //   console.log('Timer finished');
  //   setIsFinished(true); // 타이머 종료 상태 업데이트
  // };

  // useEffect(() => {
  //   // 서버에서 mouseMove 이벤트 수신
  //   socket.on('mouseMove', (data: any) => {
  //     const { x, y, playerId } = data;
  //     drawOtherPlayerCursor(x, y, playerId); // 다른 플레이어의 커서를 그립니다.
  //   });

  //   return () => {
  //     socket.off('mouseMove');
  //   };
  // }, [socket]);

  useEffect(() => {
    socket.emit('getTurn'); // 현재 턴 정보 요청
  
    socket.on('updateTurn', (data: { currentTurn: string }) => {
      console.log('Current turn:', data.currentTurn);
      setCurrentTurn(data.currentTurn); // 클라이언트 상태 업데이트
    });
  
    return () => {
      socket.off('updateTurn');
    };
  }, []);

  // Socket 이벤트 처리
  useEffect(() => {
    socket.on('mouseMove', (data: { x: number; y: number; playerId: string }) => {
      if(data.playerId !== 'player2') return;
      const timestamp = Date.now();
      // console.log("data: ", data);
      setCursors((prevCursors) => {
        const now = Date.now();
        const filteredCursors = prevCursors.filter((cursor) => now - cursor.timestamp < CURSOR_LIFETIME);

      const updatedCursors = filteredCursors.filter((cursor) => cursor.playerId !== data.playerId);
      return [...updatedCursors, { ...data, timestamp }];
      
        // playerId에 따라 기존 데이터를 업데이트
        // const updatedCursors = prevCursors.filter((cursor) => cursor.playerId !== data.playerId);
        // return [...updatedCursors, data];
      });
    });

    return () => {
      socket.off('mouseMove');
    };
  }, []);

  // useEffect(() => {
  //   socket.on('drawShape', (data: { points: Matter.Vector[]; playerId: string; customId: string; nailsInShape?: { label: string; position: Matter.Vector; collisionFilter: any }[] }) => {
  //     console.log("playerId: ", data.playerId);
  //     // console.log("customId: ", data.customId);
  //     // if(data.playerId !== 'player2') return;

  //     // 도형을 생성하며 customId를 설정
  //     const result = createPhysicsBody(data.points, false, data.customId);
  
  //     if (result) {
  //       if (result.body) {
  //         // 못(nail)을 포함한 객체의 충돌 규칙 수정
  //         // if (result.body && data.nailsInShape && data.nailsInShape.length > 0) {
  //         //   // 모든 nail의 카테고리를 병합
  //         //   const combinedCategory = data.nailsInShape.reduce((acc, nail) => {
  //         //     return acc | (nail.collisionFilter?.category || 0); // 기본값 0 처리
  //         //   }, 0);
          
  //         //   // result.body의 collisionFilter 업데이트
  //         //   result.body.collisionFilter = {
  //         //     category: combinedCategory, // 병합된 카테고리
  //         //     mask: 0xFFFF & ~combinedCategory, // 같은 카테고리와 충돌하지 않도록 설정
  //         //   };
          
  //         //   console.log(`Updated body collisionFilter: `, result.body.collisionFilter);
  //         // }
        
  //         console.log("result.body: ", result.body)
  //         console.log("data.nailsInShape: ", data.nailsInShape)
  //         console.log("data.nailsInShape.length: ", data.nailsInShape?.length)
  //         if (data.nailsInShape && data.nailsInShape.length > 0) {
  //           console.log("sdfakljsdjfaskljskldj")
  //           // 복원된 nailsInShape
  //           const restoredNailsInShape = data.nailsInShape.map((nail) =>
  //             Matter.Bodies.circle(nail.position.x, nail.position.y, 5, {
  //               isStatic: true,
  //               collisionFilter: nail.collisionFilter,
  //               render: {
  //                 fillStyle: '#ef4444',
  //               },
  //               label: nail.label,
  //             })
  //           );

  //           console.log("Restored nailsInShape: ", restoredNailsInShape);
            
  //           // 모든 nail의 카테고리를 병합
  //           const combinedCategory = restoredNailsInShape.reduce((acc, nail) => {
  //             return acc | (nail.collisionFilter?.category || 0); // 기본값 0 처리
  //           }, 0);
          
  //           // 모든 관련 body를 추적하기 위한 Set
  //           const visitedBodies = new Set<Matter.Body>();
          
  //           // Constraint로 연결된 모든 body를 탐색
  //           const findConnectedBodies = (nail: Matter.Body) => {
  //             // Matter.Composite 내의 모든 Constraints를 검색
  //             Matter.Composite.allConstraints(engineRef.current.world).forEach((constraint) => {
  //               if (constraint.bodyA === nail || constraint.bodyB === nail) {
  //                 // 연결된 body를 결정
  //                 const connectedBody = constraint.bodyA === nail ? constraint.bodyB : constraint.bodyA;
            
  //                 // null 확인
  //                 if (connectedBody && !visitedBodies.has(connectedBody)) {
  //                   visitedBodies.add(connectedBody);
            
  //                   // 재귀적으로 연결된 body 탐색
  //                   findConnectedBodies(connectedBody);
  //                 }
  //               }
  //             });
  //           };
          
  //           // restoredNailsInShape의 모든 nail에 대해 연결된 body 탐색
  //           restoredNailsInShape.forEach((nail) => {
  //             visitedBodies.add(nail);
  //             findConnectedBodies(nail);
  //           });
  //           console.log("visitedBodies: ", visitedBodies);
          
  //           // 모든 관련 body의 collisionFilter.category를 동일하게 설정
  //           visitedBodies.forEach((body) => {
  //             body.collisionFilter = {
  //               category: combinedCategory, // 병합된 카테고리
  //               mask: 0xFFFF & ~combinedCategory, // 같은 카테고리와 충돌하지 않도록 설정
  //             };
  //             console.log(`Updated body collisionFilter: `, body.label, body.collisionFilter);
  //           });
  //         }

  //         Matter.Composite.allBodies(engineRef.current.world).forEach((body) => {
  //           console.log(`Body: ${body.label}`);
  //           console.log(`Category: ${body.collisionFilter?.category}`);
  //           console.log(`Mask: ${body.collisionFilter?.mask}`);
  //         });

  //         console.log(`--------------------------------`);

  //         // Matter.js 월드에 도형 추가
  //         Matter.World.add(engineRef.current.world, result.body);
  
  //         // console.log("nails (from ref): ", nailsRef.current);
  //         // console.log("nailsInShape: ", result.nailsInShape);
  
  //         // nailsInShape와 생성된 도형을 Constraint로 연결
  //         result.nailsInShape.forEach((nail) => {
  //           const constraint = Matter.Constraint.create({
  //             bodyA: result.body, // 도형
  //             pointA: { x: nail.position.x - result.body.position.x, y: nail.position.y - result.body.position.y }, // 도형 내 nail의 상대 위치
  //             bodyB: nail, // nail
  //             pointB: { x: 0, y: 0 }, // nail 중심
  //             stiffness: 1, // 강성
  //             length: 0, // 연결 길이
  //             render: {
  //               visible: false, // Constraint 시각화를 비활성화
  //             }
  //           });
  
  //           // Matter.js 월드에 Constraint 추가
  //           Matter.Composite.add(engineRef.current.world, constraint);
  //         });
  //       }
  //     }
  //   });
  
  
  //   return () => {
  //     socket.off('drawShape');
  //   };
  // }, []);

  // useEffect(() => {
  //   socket.on('drawShape', (data: { points: Matter.Vector[]; playerId: string; customId: string; nailsInShape?: { label: string; position: Matter.Vector; collisionFilter: any }[] }) => {
  //     console.log("playerId: ", data.playerId);
  
  //     // 도형을 생성하며 customId를 설정
  //     const result = createPhysicsBody(data.points, false, data.customId);
  
  //     if (result) {
  //       if (result.body) {
  //         console.log("result.body: ", result.body);
  //         console.log("data.nailsInShape: ", data.nailsInShape);
  
  //         if (result.body && data.nailsInShape && data.nailsInShape.length > 0) {
  //           console.log("Processing nailsInShape...");
  
  //           // 모든 nail의 카테고리를 병합
  //           const combinedCategory = data.nailsInShape.reduce((acc, nail) => {
  //             return acc | (nail.collisionFilter?.category || 0); // 기본값 0 처리
  //           }, 0);
  
  //           // 모든 관련 body를 추적하기 위한 Set
  //           const visitedBodies = new Set<Matter.Body>();
  
  //           // Constraint로 연결된 모든 body를 탐색
  //           const findConnectedBodies = (nail: { label: string; position: Matter.Vector; collisionFilter: any }) => {
  //             // Matter.Composite 내의 모든 Constraints를 검색
  //             Matter.Composite.allConstraints(engineRef.current.world).forEach((constraint) => {
  //               const connectedBody = 
  //                 (constraint.bodyA && constraint.bodyA.label === nail.label) 
  //                   ? constraint.bodyB 
  //                   : (constraint.bodyB && constraint.bodyB.label === nail.label)
  //                   ? constraint.bodyA 
  //                   : null;
  
  //               // null 확인 및 중복 방지
  //               if (connectedBody && !visitedBodies.has(connectedBody)) {
  //                 visitedBodies.add(connectedBody);
  
  //                 // 재귀적으로 연결된 body 탐색
  //                 findConnectedBodies({
  //                   label: connectedBody.label,
  //                   position: connectedBody.position,
  //                   collisionFilter: connectedBody.collisionFilter,
  //                 });
  //               }
  //             });
  //           };
  
  //           // nailsInShape의 모든 nail에 대해 연결된 body 탐색
  //           data.nailsInShape.forEach((nail) => {
  //             findConnectedBodies(nail);
  //           });
  //           console.log("visitedBodies: ", visitedBodies);
  
  //           // 모든 관련 body의 collisionFilter.category를 동일하게 설정
  //           visitedBodies.forEach((body) => {
  //             body.collisionFilter = {
  //               category: combinedCategory, // 병합된 카테고리
  //               mask: 0xFFFF & ~combinedCategory, // 같은 카테고리와 충돌하지 않도록 설정
  //             };
  //             console.log(`Updated body collisionFilter: `, body.label, body.collisionFilter);
  //           });
  //         }
  
  //         Matter.Composite.allBodies(engineRef.current.world).forEach((body) => {
  //           console.log(`Body: ${body.label}`);
  //           console.log(`Category: ${body.collisionFilter?.category}`);
  //           console.log(`Mask: ${body.collisionFilter?.mask}`);
  //         });
  
  //         console.log(`--------------------------------`);
  
  //         // Matter.js 월드에 도형 추가
  //         Matter.World.add(engineRef.current.world, result.body);
  
          // // nailsInShape와 생성된 도형을 Constraint로 연결
          // if (result.nailsInShape) {
          //   result.nailsInShape.forEach((nail) => {
          //     const constraint = Matter.Constraint.create({
          //       bodyA: result.body, // 도형
          //       pointA: { x: nail.position.x - result.body.position.x, y: nail.position.y - result.body.position.y }, // 도형 내 nail의 상대 위치
          //       bodyB: nail, // nail
          //       pointB: { x: 0, y: 0 }, // nail 중심
          //       stiffness: 1, // 강성
          //       length: 0, // 연결 길이
          //       render: {
          //         visible: false, // Constraint 시각화를 비활성화
          //       },
          //     });
  
          //     // Matter.js 월드에 Constraint 추가
          //     Matter.Composite.add(engineRef.current.world, constraint);
          //   });
          // }
  //       }
  //     }
  //   });
  
  //   return () => {
  //     socket.off('drawShape');
  //   };
  // }, []);

  useEffect(() => {
    socket.on('drawShape', (data: { points: Matter.Vector[]; playerId: string; customId: string; collisionCategory?: number; groupNumber?: number}) => {
      console.log("playerId: ", data.playerId);
  
      // 도형을 생성하며 customId를 설정
      const result = createPhysicsBody(data.points, false, data.collisionCategory ?? 0x0001, data.groupNumber ?? 0, data.customId) as { body: Matter.Body; nailsInShape: Matter.Body[] };

      if(result) {
        if (result.body) {
          // Matter.js 월드에 도형 추가
          Matter.World.add(engineRef.current.world, result.body);
  
          if (result.nailsInShape.length > 0) {
            const targetBody = result.body;

            // nailsInShape와 생성된 도형을 Constraint로 연결
            if (result.nailsInShape) {
              result.nailsInShape.forEach((nail) => {
                const constraint = Matter.Constraint.create({
                  bodyA: targetBody, // 도형
                  pointA: { x: nail.position.x - result.body.position.x, y: nail.position.y - result.body.position.y }, // 도형 내 nail의 상대 위치
                  bodyB: nail, // nail
                  pointB: { x: 0, y: 0 }, // nail 중심
                  stiffness: 1, // 강성
                  length: 0, // 연결 길이
                  render: {
                    visible: false, // Constraint 시각화를 비활성화
                  },
                });
    
                // Matter.js 월드에 Constraint 추가
                Matter.Composite.add(engineRef.current.world, constraint);
              });
            }
          }
        }
      }
    })
  
    return () => {
      socket.off('drawShape');
    };
  }, []);

  useEffect(() => {
    // drawPin 이벤트 처리
    const handleDrawPin = (data: { customId: string; centerX: number; centerY: number; radius: number; category: number; groupNumber: number; playerId: string; currentLevel: number }) => {
      console.log("Received drawPin data: ", data);

      // 클릭 위치에 존재하는 사물을 찾음
      const mousePosition = { x: data.centerX, y: data.centerY };
      const bodies = Matter.Composite.allBodies(engineRef.current.world);
      const targetBody = bodies.find((body) =>
        Matter.Bounds.contains(body.bounds, mousePosition)
      );

      // 사물이 없으면 못을 생성하지 않음
      if (!targetBody) {
        console.log("No body found under the nail position.");
        return null;
      }
 
      // 못(nail) 생성
      const nail = Matter.Bodies.circle(data.centerX, data.centerY, data.radius, {
        isStatic: targetBody.isStatic ? true : false,
        collisionFilter: {
          group: data.groupNumber,
          category: data.category, // Nail의 카테고리
          // mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
          mask: 0x0000,
        },
        render: {
          // fillStyle: '#ef4444', // 못의 색상
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: data.customId || `nail_${Date.now()}`, // Assign customId
        mass: 30,
      });

      // 기존 nail들의 category 값 가져오기
      const existingCategories = nailsRef.current
      .map((nail) => nail.collisionFilter.category)
      .filter((category): category is number => category !== undefined);

      // 기존 nail들의 category 값을 |로 연결
      const additionalMask = existingCategories.reduce(
        (mask, category) => mask | category,
        0x0000 // 초기값 0
      );

      // 못(nail)을 포함한 객체의 충돌 규칙 수정
      targetBody.collisionFilter = {
        group: data.groupNumber,
        category: data.category, // Nail과 같은 카테고리
        // mask: 0xFFFF,
        // mask: 0xFFFF & ~data.category | 0x0001, // 같은 카테고리끼리 충돌하지 않도록 설정
        // mask: (0xFFFF & ~data.category) | 0x0001 | additionalMask, // 기존 category 추가
        // mask: 0x0001 | additionalMask, // 기존 category 추가
        // mask: 0x0100 | 0x0001,
        mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
      }

      console.log("(0xFFFF & ~data.category) | 0x0001 | additionalMask: ", (0xFFFF & ~data.category) | 0x0001 | additionalMask)
      console.log("targetBody.collisionFilter: ", targetBody.collisionFilter)
      console.log("targetBody: ", targetBody)

      // // 물리 엔진 업데이트
      // Matter.Engine.update(engineRef.current);

      // 상태에 nail 추가
      addNail(nail);
      console.log("sdfnail: ", nail);
      console.log("sdfnails: ", nails);
      
      // Matter.js 월드에 nail 추가
      Matter.Composite.add(engineRef.current.world, nail);

      // 도형(targetBody)와 못(nail)을 Constraint로 연결
      const constraint = Matter.Constraint.create({
        bodyA: targetBody, // 도형
        pointA: {
          x: nail.position.x - targetBody.position.x,
          y: nail.position.y - targetBody.position.y,
        },
        bodyB: nail, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      // Matter.js 월드에 Constraint 추가
      Matter.Composite.add(engineRef.current.world, constraint);
    };
  
    // 소켓 이벤트 리스너 등록
    socket.on('drawPin', handleDrawPin);
  
    return () => {
      // 리스너 정리
      socket.off('drawPin', handleDrawPin);
    };
  }, []);

  useEffect(() => {
    socket.on('resetLevel', (data: { level: number }) => {
      console.log(`Resetting level to: ${data.level}`);
      
      // 월드와 렌더를 정지하고 지운 후, 다시 설정
      const world = engineRef.current.world;
      Matter.World.clear(world, false);
      Matter.Engine.clear(engineRef.current);
  
      if (renderRef.current) {
        Matter.Render.stop(renderRef.current);
        Matter.Render.run(renderRef.current);
      }

      resetNails();
  
      // 수신한 레벨로 초기화
      setCurrentLevel(data.level);
      setResetTrigger((prev) => !prev);
    });
  
    return () => {
      socket.off('resetLevel');
    };
  }, []);

  useEffect(() => {
    socket.on('erase', (data: { customId: string; playerId: string }) => {
    //   const body = Matter.Composite.allBodies(engineRef.current.world).find(
    //     (b) => b.label === data.customId
    //   );
    //   if (body) {
    //     Matter.World.remove(engineRef.current.world, body);
    //   }
    // });

      // 1) 월드에 존재하는 모든 바디 조회
      const allBodies = Matter.Composite.allBodies(engineRef.current.world);
    
      // 0) customId가 "nail"로 시작하는지 아닌지 확인
      if(data.customId.startsWith("nail")) {
        // 2) label이 data.customId와 일치하는 Body 찾기
        const targetBody = allBodies.find(b => b.label === data.customId);

        if (targetBody) {
          // 3) 월드에 존재하는 모든 Constraint 조회
          const allConstraints = Matter.Composite.allConstraints(engineRef.current.world);

          // 4) targetBody와 연결된 Constraint( bodyA === targetBody || bodyB === targetBody )를 모두 찾아 제거하고 기존 targetBody들 충돌계수 수정
          const constraintsToRemove = allConstraints.filter(ct => {
            return ct.bodyA === targetBody || ct.bodyB === targetBody;
          });

          // pin 하나만 있을 때 (pin에 연결된 것이 없을 때)
          if(constraintsToRemove.length === 0) {
            socket.emit('releaseCategory', {
              playerId: 'player1',
              currentLevel,
              category: targetBody.collisionFilter.category
            });
          } else { // pin에 연결된 것이 한 개 이상 있을 때
            let isOtherContraintBody = false
            let otherContraintBodyCategory;
            constraintsToRemove.forEach(ct => {
              const otherBody = 
              ct.bodyA === targetBody 
                ? ct.bodyB 
                : ct.bodyA;
  
              if(otherBody) {
                // (A) "constraintsToRemove" 이외의 Constraint 중에서,
                //      otherBody가 연결된 것이 있는지 검사
                const otherConstraints = allConstraints.filter(otherCt => {
                  // 이미 "constraintsToRemove"에 포함된 것 제외
                  if (constraintsToRemove.includes(otherCt)) return false;
  
                  // bodyA나 bodyB가 'otherBody'인지 확인
                  return otherCt.bodyA === otherBody || otherCt.bodyB === otherBody;
                });
                console.log("otherContraints: ", otherConstraints)
                // (B) otherConstraints가 비어 있다면 (= 0개),
                //     즉 "otherBody"가 이외의 다른 Constraint에 연결되지 않았다면
                if (otherConstraints.length === 0) {
                  // => 여기서 collisionFilter 변경
                  otherBody.collisionFilter = {
                    group: 0,
                    category: 0x0001, // 기본값 예시
                    mask: 0xFFFF
                  };
                } else { // "otherBody"가 이외의 다른 Constraint에 연결되어 있다면
                  // isOtherContraintBody = true
                  // otherContraintBodyCategory = otherBody.collisionFilter.category;
                  // otherConstraints.forEach(ct => {
                  //   // ─────────────────────────────────────────────────────────
                  //   // 1) 탐색을 위한 방문 집합
                  //   // ─────────────────────────────────────────────────────────
                  //   const visitedConstraints = new Set<Matter.Constraint>();
                  //   const visitedBodies = new Set<Matter.Body>();
                  
                  //   // targetBody를 찾았는지 여부
                  //   let foundTarget = false;
                  
                  //   // BFS 큐(초기값: 현재 ct)
                  //   const queue: Matter.Constraint[] = [ct];
                  
                  //   // ─────────────────────────────────────────────────────────
                  //   // 2) BFS 로직
                  //   // ─────────────────────────────────────────────────────────
                  //   while (queue.length > 0) {
                  //     // 큐에서 하나 꺼냄
                  //     const currentCt = queue.shift();
                  //     if (!currentCt) continue;
                  
                  //     // 이미 방문한 Constraint이면 스킵
                  //     if (visitedConstraints.has(currentCt)) {
                  //       continue;
                  //     }
                  //     // 방문 처리
                  //     visitedConstraints.add(currentCt);
                  
                  //     // currentCt에 연결된 두 바디
                  //     const bodies = [currentCt.bodyA, currentCt.bodyB];
                  //     for (const body of bodies) {
                  //       if (!body) continue;
                  
                  //       // 만약 이 body가 targetBody라면 -> foundTarget = true
                  //       if (body === targetBody) {
                  //         foundTarget = true;
                  //       }
                  
                  //       // 아직 방문 안 한 Body면 방문
                  //       if (!visitedBodies.has(body)) {
                  //         visitedBodies.add(body);
                  
                  //         // 이 Body와 연결된 (하지만 제거되지 않을) 다른 Constraint들을 찾아 큐에 추가
                  //         const bConstraints = allConstraints.filter(otherCt => {
                  //           // 이미 제거 예정인 constraintsToRemove엔 포함되지 않아야 하고
                  //           if (constraintsToRemove.includes(otherCt)) return false;
                  
                  //           // bodyA나 bodyB가 현재 body인 경우
                  //           return (otherCt.bodyA === body || otherCt.bodyB === body);
                  //         });
                  
                  //         for (const bc of bConstraints) {
                  //           if (!visitedConstraints.has(bc)) {
                  //             queue.push(bc);
                  //           }
                  //         }
                  //       }
                  //     }
                  //   }
                  
                  //   // ─────────────────────────────────────────────────────────
                  //   // 3) BFS 결과: visitedBodies에 연결된 모든 body가 모임
                  //   //    만약 foundTarget == false라면 targetBody가 없으므로,
                  //   //    visitedBodies 전부의 category를 0x0004로 변경
                  //   // ─────────────────────────────────────────────────────────
                  //   if (!foundTarget) {
                  //     visitedBodies.forEach(body => {
                  //       body.collisionFilter.category = 0x0004;
                  //       // 필요하다면 group/mask 등도 함께 세팅 가능
                  //     });
                  //   }
                  // });
                }
              }
  
  
              // Constraint 제거
              Matter.World.remove(engineRef.current.world, ct);
            });
            if(!isOtherContraintBody) {
              socket.emit('releaseCategory', {
                playerId: 'player1',
                currentLevel,
                category: otherContraintBodyCategory
              });
            }
          }

          

          // 6) 마지막으로 해당 body 자체 제거
          Matter.World.remove(engineRef.current.world, targetBody);

          console.log(`Body(label='${data.customId}') & all connected constraints removed`);
        }
      } else if(data.customId.startsWith("chain")) {
        console.log("sdfsdfasdfkjaslfdlkadsfjklfdsldsf")
        const constraintsToRemove = Matter.Composite.allConstraints(engineRef.current.world).filter(
          (ct) => ct.label && ct.label.startsWith(data.customId)
        );

        console.log("constraintsToRemove: ", constraintsToRemove);
        
        constraintsToRemove.forEach((ct) => {
          Matter.World.remove(engineRef.current.world, ct);
        }); 
      } else {
        // 2) customId에 해당하는 Body 찾기
        const bodyToRemove = allBodies.find(b => b.label === data.customId);
        if (!bodyToRemove) return;

        // 3) 원본 Body와 연결된 모든 Constraint를 찾는다
        const allConstraints = Matter.Composite.allConstraints(engineRef.current.world);
        const constraintsOfMainBody = allConstraints.filter(ct => {
          return ct.bodyA === bodyToRemove || ct.bodyB === bodyToRemove;
        });

        // 4) 해당 Constraint 제거 & 연결된 nail Body 처리
        constraintsOfMainBody.forEach(constraint => {
          const nail = 
          constraint.bodyA === bodyToRemove 
              ? constraint.bodyB 
              : constraint.bodyA;
          console.log("nail: ", nail?.label);
          const contraintsOfNail = allConstraints.filter(otherCt => {
            if (constraintsOfMainBody.includes(otherCt) || otherCt.label.startsWith("chain")) return false;
            return otherCt.bodyA === nail || otherCt.bodyB === nail;
          });
          console.log("contraintsOfNail: ", contraintsOfNail);
          if(contraintsOfNail.length === 0) {
            console.log("asdfasfdfdsfd")
            const nailToRemove = nail
            if(nailToRemove) {
              console.log("nailToRemove: ", nailToRemove.label);
              const customId = nailToRemove.label;
              // 서버에 삭제 요청 전송
              socket.emit('erase', {
                customId,
                playerId: 'player1',
                currentLevel
              });
            }
            // Constraint 자체 제거
            Matter.World.remove(engineRef.current.world, constraint);
          } else {
            // Constraint 자체 제거
            Matter.World.remove(engineRef.current.world, constraint);
          }
        });
        // 5) 마지막으로 원본 Body 제거
        Matter.World.remove(engineRef.current.world, bodyToRemove);
      }
      // // 3) 해당 Constraint 제거 & 연결된 nail Body 처리
      // constraintsOfMainBody.forEach(constraint => {
      //   // Constraint 자체 제거
      //   Matter.World.remove(engineRef.current.world, constraint);

      //   // constraint의 "반대편" Body (원본 bodyToRemove가 아닌 쪽)
      //   const otherBody = 
      //     constraint.bodyA === bodyToRemove 
      //       ? constraint.bodyB 
      //       : constraint.bodyA;

      //   // 만약 otherBody가 nail 라벨이라면, 그 nail과 연결된 모든 Constraint도 지우고 nail도 지운다
      //   if (otherBody?.label?.startsWith('nail')) {
      //     // nail과 연결된 Constraint를 모두 찾는다
      //     const nailConstraints = allConstraints.filter(ctNail => {
      //       return ctNail.bodyA === otherBody || ctNail.bodyB === otherBody;
      //     });
      //     // nail이 연결된 모든 Constraint 제거
      //     nailConstraints.forEach(nailCt => {
      //       Matter.World.remove(engineRef.current.world, nailCt);
      //     });
      //     // nail Body 제거
      //     Matter.World.remove(engineRef.current.world, otherBody);
      //   }
      // });

      // // 4) 마지막으로 원본 Body 제거
      // Matter.World.remove(engineRef.current.world, bodyToRemove);
    });
  
    return () => {
      socket.off('erase');
    };
  }, []);

  useEffect(() => {
    socket.on('push', (data: { force: { x: number; y: number }; playerId: string }) => {
      if (ballRef.current && !pushLock) {
        const ball = ballRef.current;
        Matter.Body.applyForce(ball, ball.position, data.force);
        
        // setPushLock(true);
      }
    });
  
    return () => {
      socket.off('push');
    };
  }, []);

  useEffect(() => {
    socket.on('changeTool', (data: { tool: 'pen' | 'eraser' | 'pin' | 'chain' | 'push'; playerId: string }) => {
      console.log(`Tool changed to: ${data.tool} by player: ${data.playerId}`);
      setTool(data.tool);
    });
  
    return () => {
      socket.off('changeTool');
    };
  }, []);

  useEffect(() => {
    socket.on('changeLevel', (data: { level: number; direction: string; playerId: string }) => {
      console.log(`Level changed to: ${data.level} by player: ${data.playerId}`);
      resetNails();
      setCurrentLevel(data.level); // 레벨 업데이트
      setGameEnded(false); // 게임 종료 상태 초기화
    });
  
    return () => {
      socket.off('changeLevel');
    };
  }, []);

  // // 상대방 커서 움직임을 캔버스에 그리기
  // useEffect(() => {
  //   const canvas = cursorCanvasRef.current;
  //   if (!canvas) return;
  //   const ctx = canvas.getContext('2d');
  //   if (!ctx) return;

  //   const draw = () => {
  //     // 캔버스를 초기화
  //     ctx.clearRect(0, 0, canvas.width, canvas.height);

  //     console.log("draw");
  //     // 모든 커서를 다시 그림
  //     cursors.forEach(({ x, y, playerId }) => {
  //       console.log("cursors[0].playerId: ", cursors[0].playerId);
  //       ctx.beginPath();
  //       ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
  //       ctx.fillStyle = playerId === 'player1' ? 'blue' : 'red'; // 플레이어별 색상
  //       ctx.fill();
  //     });

  //     requestAnimationFrame(draw); // 애니메이션 프레임 요청
  //   };

  //   draw();

  //   return () => {
  //     cancelAnimationFrame(draw);
  //   };
  // }, [cursors]); // cursors가 변경될 때마다 다시 그림

  // useEffect(() => {
  //   const canvas = cursorCanvasRef.current;
  //   if (!canvas) return;
  //   const ctx = canvas.getContext('2d');
  //   if (!ctx) return;
  
  //   let animationFrameId: number;
  
  //   const draw = () => {
  //     // 캔버스를 초기화
  //     ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  //     if (cursors.length > 0) {
  //       // 모든 커서를 다시 그림
  //       cursors.forEach(({ x, y, playerId }) => {
  //         ctx.beginPath();
  //         ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
  //         ctx.fillStyle = playerId === 'player1' ? 'blue' : 'red'; // 플레이어별 색상
  //         ctx.fill();
  //       });
  //       console.log("draw"); // 조건에 상관없이 호출됨
  //     }
  //     animationFrameId = requestAnimationFrame(draw); // 애니메이션 프레임 요청
  //   };
  
  //   draw();
  
  //   return () => {
  //     cancelAnimationFrame(animationFrameId);
  //   };
  // }, [cursors]);

  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    let animationFrameId: number | null = null;
  
    const draw = () => {
      // 캔버스를 초기화
      ctx.clearRect(0, 0, canvas.width, canvas.height);
  
      if (cursors.length > 0) {
        // console.log("draw");
        // 모든 커서를 다시 그림
        cursors.forEach(({ x, y, playerId }) => {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
          ctx.fillStyle = playerId === 'player1' ? 'blue' : 'red'; // 플레이어별 색상
          ctx.fill();
        });
        // 다음 애니메이션 프레임 요청
        animationFrameId = requestAnimationFrame(draw);
      } else {
        // 애니메이션 종료
        cancelAnimationFrame(animationFrameId!);
        animationFrameId = null;
      }
    };
  
    if (cursors.length > 0) {
      // 애니메이션 시작
      draw();
    }
  
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [cursors]);

  // useEffect(() => {
  //   setTimeout(() => setPushLock(false), 5000);
  // }, [pushLock]);

  useEffect(() => {
    if (!canvasRef.current) return;

    // 렌더링 객체 초기화
    if (renderRef.current) {
      Matter.Render.stop(renderRef.current); // 이전 렌더 중지
      // renderRef.current.canvas.remove(); // 기존 캔버스 해제
      renderRef.current = null;
      console.log("렌더링 객체 초기화 완료")
    }

    const render = Matter.Render.create({
      canvas: canvasRef.current,
      engine: engineRef.current,
      options: {
        width: 800,
        height: 600,
        // hasBounds: true,
        // showCollisions: true,
        wireframes: false,
        background: '#f8f4e3',
      },
    });
    console.log("Render.create 완료")
    renderRef.current = render;

    engineRef.current.world.gravity.y = 0.1;

    // 기존 러너가 있으면 중지
    if (runnerRef.current) {
      Matter.Runner.stop(runnerRef.current);
      runnerRef.current = null;
      console.log("기존 러너 중지 완료")
    }

    // 새로운 러너 생성 및 실행
    const runner = Matter.Runner.create({
      delta: 25,
      isFixed: true, // 고정된 시간 간격 유지
    });
    Matter.Runner.run(runner, engineRef.current);
    runnerRef.current = runner;

    Matter.Render.run(render);

    // 월드 및 레벨 초기화
    const world = engineRef.current.world;
    Matter.World.clear(world, false);
    // initializeLevel(currentLevel); // 레벨 초기화 함수 호출

    // const world = engineRef.current.world;
    
    // // 월드 초기화
    // Matter.World.clear(world, false);

    // 레벨에 따른 설정
    if (currentLevel === 1) {
      // 레벨 1 기본 설정
      const wallOptions = {
        isStatic: true,
        label: 'wall',
        friction: 1,
        frictionStatic: 1,
        restitution: 0.2,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      };
  
      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, wallOptions),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, wallOptions),
        // Matter.Bodies.rectangle(810, 300, 20, 620, wallOptions),
      ];
  
      walls.forEach(wall => {
        Matter.Body.setStatic(wall, true);
        wall.render.fillStyle = '#94a3b8';
      });
  
      const ball = Matter.Bodies.circle(200, 300, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3, // 반발 계수: 공이 튀어오르는 정도
        friction: 0.01, // 마찰력
        frictionAir: 0.01, // 공중에서의 저항
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      ballRef.current = ball;  // ballRef에 공을 할당하여 참조하도록 합니다
      initialBallPositionRef.current = { x: 200, y: 300 }
      
      const star = Matter.Bodies.trapezoid(600, 290, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
  
      // Add static bodies to represent the castle structure
      // const ground = Matter.Bodies.rectangle(400, 590, 810, 60, { isStatic: true, label: 'ground'});
      const tower1 = Matter.Bodies.rectangle(200, 400, 50, 200, { isStatic: true, label: 'tower1', collisionFilter: {
        category: 0x0001,
        mask: 0xFFFF,
      }});
      const tower2 = Matter.Bodies.rectangle(300, 400, 50, 200, { isStatic: true, label: 'tower2', collisionFilter: {
        category: 0x0001,
        mask: 0xFFFF,
      }});
      const tower3 = Matter.Bodies.rectangle(400, 400, 50, 200, { isStatic: true, label: 'tower3', collisionFilter: {
        category: 0x0001,
        mask: 0xFFFF,
      }});
      const tower4 = Matter.Bodies.rectangle(500, 400, 50, 200, { isStatic: true, label: 'tower4', collisionFilter: {
        category: 0x0001,
        mask: 0xFFFF,
      }});
      const tower5 = Matter.Bodies.rectangle(600, 400, 50, 200, { isStatic: true, label: 'tower5', collisionFilter: {
        category: 0x0001,
        mask: 0xFFFF,
      }});
  
      // Matter.World.add(world, [ground, tower1, tower2, tower3, tower4, tower5, ...walls, ball, star]);
      Matter.World.add(world, [tower1, tower2, tower3, tower4, tower5, ...walls, ball, star]);
    } else if (currentLevel === 2) {
      const world = engineRef.current.world;

      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];

      const ball = Matter.Bodies.circle(200, 500, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.01,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 200, y: 500 };

      const horizontalPlatform = Matter.Bodies.rectangle(400, 550, 700, 200, {
        isStatic: true,
        label: 'horizontal_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const star = Matter.Bodies.trapezoid(650, 430, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });

      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        horizontalPlatform,
      ]);

      ballRef.current = ball;
    }
    // } else if (currentLevel === 3) {
      // const walls = [
      //   Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom' }),
      //   Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall' }),
      //   Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall' }),
      //   Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall' }),
      // ];
  
      // // 공 (ball)과 별 (balloon) 위치 설정
      // const ball = Matter.Bodies.circle(400, 400, 15, {
      //   render: { fillStyle: '#ef4444' },
      //   label: 'ball',
      //   restitution: 0.3,
      //   friction: 0.05,
      //   frictionAir: 0.01,
      // });
      // initialBallPositionRef.current = { x: 400, y: 400 }

      // const star = Matter.Bodies.trapezoid(600, 550, 20, 20, 1, {
      //   render: { fillStyle: '#fbbf24' },
      //   label: 'balloon',
      //   isStatic: true,
      // });
  
      // // 맵 내 정적 객체 생성
      // const base = Matter.Bodies.rectangle(400, 580, 100, 20, { isStatic: true, label: 'base' });
      // const pedestal = Matter.Bodies.rectangle(400, 500, 50, 100, { isStatic: true, label: 'pedestal' });
  
      // Matter.World.add(world, [ball, star, base, pedestal, ...walls]);
      // ballRef.current = ball;
    // } else if (currentLevel === 4) {
    else if (currentLevel === 3) {
      const world = engineRef.current.world;

      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];

      // Ball setup
      const ball = Matter.Bodies.circle(150, 460, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 1,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 150, y: 460 };
    
      // Star (Goal) setup
      const star = Matter.Bodies.trapezoid(730, 465, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });

      const horizontalPlatformForBall = Matter.Bodies.rectangle(150, 500, 30, 30, {
        isStatic: true,
        label: 'horizontal_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const horizontalPlatform = Matter.Bodies.rectangle(500, 565, 500, 100, {
        isStatic: true,
        label: 'horizontal_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      // 경사면으로 사용할 회전된 직사각형 body 생성
      const slope = Matter.Bodies.rectangle(615, 498, 200, 5, {
        isStatic: true, // 고정된 경사면이므로 isStatic을 true로 설정
        angle: -Math.PI / 15, // 시계 반대방향으로 22.5도 회전 (경사면 경사각도 조절)
        render: {
          fillStyle: '#6c757d',
        },
      });

      const horizontalPlatformForStar = Matter.Bodies.rectangle(730, 495, 40, 40, {
        isStatic: true,
        label: 'horizontal_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      // 구름 모양 꼭짓점 배열
      const cloudVertices = [
        { x: 0,   y: 20 },
        { x: 20,  y: 0 },
        { x: 50,  y: -5 },
        { x: 80,  y: 0 },
        { x: 100, y: 20 },
        { x: 90,  y: 40 },
        { x: 70,  y: 50 },
        { x: 50,  y: 45 },
        { x: 30,  y: 50 },
        { x: 10,  y: 40 }
      ];

      // 구름 Body 생성, (400, 300) 위치에 생성됨.
      const cloud = Matter.Bodies.fromVertices(150, 300, [cloudVertices], {
        isStatic: true,
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)',
          strokeStyle: '#397896',
          lineWidth: 5
        },
      }, true);

      // 구름을 2.5배 확대
      Matter.Body.scale(cloud, 2.5, 1.5);

      // Adding everything to the world
      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        horizontalPlatformForBall,
        horizontalPlatform,
        slope,
        horizontalPlatformForStar,
        cloud,
      ]);
    
      ballRef.current = ball;
    } else if (currentLevel === 4) {
      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];
    
      const ball = Matter.Bodies.circle(400, 180, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 400, y: 180 };
    
      const star = Matter.Bodies.trapezoid(400, 350, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
    
      const topBar = Matter.Bodies.rectangle(400, 200, 150, 10, {
        isStatic: true,
        label: 'top_bar',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const verticalBar = Matter.Bodies.rectangle(400, 250, 10, 100, {
        isStatic: true,
        label: 'vertical_bar',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const redBox = Matter.Bodies.rectangle(400, 375, 30, 30, {
        isStatic: true,
        label: 'red_box',
        render: { fillStyle: '#ef4444' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const leftUpGreenPlatform = Matter.Bodies.rectangle(200, 300, 60, 10, {
        isStatic: true,
        label: 'left_up_green_platform',
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const leftDownGreenPlatform = Matter.Bodies.rectangle(250, 500, 60, 10, {
        isStatic: true,
        label: 'left_down_green_platform',
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const rightUpGreenPlatform = Matter.Bodies.rectangle(550, 300, 60, 10, {
        isStatic: true,
        label: 'right_up_green_platform',
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const rightDownGreenPlatform = Matter.Bodies.rectangle(500, 500, 60, 10, {
        isStatic: true,
        label: 'right_down_green_platform',
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        topBar,
        verticalBar,
        redBox,
        leftUpGreenPlatform,
        leftDownGreenPlatform,
        rightUpGreenPlatform,
        rightDownGreenPlatform,
      ]);
      ballRef.current = ball;
    } else if (currentLevel === 5) {
      const world = engineRef.current.world;

      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];

/*       const ball = Matter.Bodies.circle(150, 400, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 150, y: 400 };

      const horizontalPlatform = Matter.Bodies.rectangle(150, 450, 200, 150, {
        isStatic: true,
        label: 'horizontal_down_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const star = Matter.Bodies.trapezoid(700, 350, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      }); */


      // 못(nail) 생성
      const centerX4_0 = 475;
      const centerY4_0 = 240;
      const radius4 = 10;
      const nail4_0 = Matter.Bodies.circle(centerX4_0, centerY4_0, radius4, {
        isStatic: true,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail4_0', // Assign customId
        mass: 30,
      });

      // 못(nail)을 포함한 객체의 충돌 규칙 수정
      // targetBody.collisionFilter = {
      //   group: data.groupNumber,
      //   category: data.category, // Nail과 같은 카테고리
      //   mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
      // }

      socket.emit('registerPin', { centerX4_0, centerY4_0, radius4, playerId: 'player1', customId: 'nail4_0', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail4_0);

      // 못(nail) 생성
      const centerX4_1 = 475;
      const centerY4_1 = 280;
      const nail4_1 = Matter.Bodies.circle(centerX4_1, centerY4_1, radius4, {
        isStatic: false,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail4_1', // Assign customId
        mass: 30,
      });


      socket.emit('registerPin', { centerX4_1, centerY4_1, radius4, playerId: 'player1', customId: 'nail4_1', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail4_1);

      // 못(nail) 생성
      const centerX4_2 = 475;
      const centerY4_2 = 310;
      const nail4_2 = Matter.Bodies.circle(centerX4_2, centerY4_2, radius4, {
        isStatic: false,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail4_2', // Assign customId
        mass: 30,
      });


      socket.emit('registerPin', { centerX4_1, centerY4_1, radius4, playerId: 'player1', customId: 'nail4_2', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail4_2);

      // 원래 맵 그대로 공이 국자 위에 놓임
      const ball = Matter.Bodies.circle(400, 442, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
      });
      initialBallPositionRef.current = { x: 400, y: 442 };

      // 원래 맵 그대로 장애물 + 국자
      const obstacle = Matter.Bodies.rectangle(400, 150, 100, 150, {
        isStatic: true,
        label: 'obstacle',
        render: { fillStyle: '#6b7280' },
      });

      // 손잡이 부분 rectangle 생성
      const handle = Matter.Bodies.rectangle(475, 240, 50, 420, { 
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        }, 
      });

      // 머리 부분 rectangle 생성
      const head1 = Matter.Bodies.rectangle(425, 475, 150, 50, { 
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        }, 
      });

      const head2 = Matter.Bodies.rectangle(325, 450, 50, 100, { 
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        }, 
      });      

      // group 생성
      const scoop = Matter.Body.create({
        parts: [handle, head1, head2], // rectangle들을 추가
        isStatic: false,
        label: 'scoop',
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        }, 
      });


      const star = Matter.Bodies.trapezoid(300, 335, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
      
      // 도형(targetBody)와 못(nail)을 Constraint로 연결
      const constraint4_0 = Matter.Constraint.create({
        bodyA: scoop, // 도형
        pointA: { x: centerX4_0 - scoop.position.x, y: centerY4_0 - scoop.position.y }, // 도형 내부의 연결 지점
        bodyB: nail4_0, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      const constraint4_1 = Matter.Constraint.create({
        bodyA: scoop, // 도형
        pointA: { x: centerX4_1 - scoop.position.x, y: centerY4_1 - scoop.position.y }, // 도형 내부의 연결 지점
        bodyB: nail4_1, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });
      
      const constraint4_2 = Matter.Constraint.create({
        bodyA: scoop, // 도형
        pointA: { x: centerX4_2 - scoop.position.x, y: centerY4_2 - scoop.position.y }, // 도형 내부의 연결 지점
        bodyB: nail4_2, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });      


      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        obstacle,
        scoop,
        nail4_0,
        nail4_1,
        nail4_2,
        constraint4_0,
        constraint4_1,
        constraint4_2,
        // horizontalPlatform,
      ]);

      ballRef.current = ball;
    } else if (currentLevel === 6) {
      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall_top', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall_left', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall_right', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];
    
      // Ball starting position
      const ball = Matter.Bodies.circle(100, 300, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 100, y: 300 };
    
      // Star (goal) position
      const star = Matter.Bodies.trapezoid(650, 520, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
    
      // U-shaped red platform
      const leftVerticalWall = Matter.Bodies.rectangle(600, 335, 40, 450, {
        isStatic: true,
        label: 'left_red_wall',
        render: { fillStyle: '#ef4444' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      const rightVerticalWall = Matter.Bodies.rectangle(700, 335, 40, 450, {
        isStatic: true,
        label: 'right_red_wall',
        render: { fillStyle: '#ef4444' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      const bottomHorizontalWall = Matter.Bodies.rectangle(650, 550, 140, 30, {
        isStatic: true,
        label: 'bottom_red_wall',
        render: { fillStyle: '#ef4444' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        leftVerticalWall,
        rightVerticalWall,
        bottomHorizontalWall,
      ]);
      ballRef.current = ball;

      // const world = engineRef.current.world;

      // const walls = [
      //   Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom' }),
      //   Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall' }),
      //   Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall' }),
      //   Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall' }),
      // ];

      // const ball = Matter.Bodies.circle(400, 100, 15, {
      //   render: { fillStyle: '#ef4444' },
      //   label: 'ball',
      //   restitution: 0.3,
      //   friction: 0.05,
      //   frictionAir: 0.01,
      // });
      // initialBallPositionRef.current = { x: 400, y: 100 };

      // const star = Matter.Bodies.trapezoid(400, 400, 20, 20, 1, {
      //   render: { fillStyle: '#fbbf24' },
      //   label: 'balloon',
      //   isStatic: true,
      // });

      // const horizontalPlatform = Matter.Bodies.rectangle(400, 150, 150, 20, {
      //   isStatic: true,
      //   label: 'horizontal_platform',
      //   render: { fillStyle: '#6b7280' },
      // });

      // Matter.World.add(world, [
      //   ...walls,
      //   ball,
      //   star,
      //   horizontalPlatform,
      // ]);

      // ballRef.current = ball;
    } else if (currentLevel === 7) {
      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom',collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }), // 바닥
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall_top',collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }), // 상단
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall_left', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }), // 왼쪽 벽
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall_right', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }), // 오른쪽 벽
      ];
    
      // 공 설정 (초기 위치와 속성)
      const ball = Matter.Bodies.circle(500, 250, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3, // 반발 계수
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 500, y: 250 };
    
      // 별 설정 (왼쪽 위 플랫폼 위)
      const star = Matter.Bodies.trapezoid(150, 310, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
    
      // 수평 빨간 플랫폼 (별 아래)
      const redPlatform = Matter.Bodies.rectangle(120, 340, 250, 30, {
        isStatic: true,
        label: 'red_platform',
        render: { fillStyle: '#ef4444' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      // 오른쪽 초록 경사면
      // const greenRamp = Matter.Bodies.rectangle(500, 350, 150, 10, {
        // isStatic: true,
        // label: 'green_ramp',
        // render: { fillStyle: '#10b981' },
        // angle: Math.PI / 6, // 경사각 30도
      // });
      const greenRamp = Matter.Bodies.trapezoid(520, 310, 220, 100, 2, {
        isStatic: true,
        label: 'green_ramp',
        render: { fillStyle: '#10b981' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      // 중앙 파란 장애물 (선택적 추가)
      const centralUpObstacle = Matter.Bodies.rectangle(400, 170, 90, 350, {
        isStatic: true,
        label: 'central_obstacle',
        render: { fillStyle: '#3b82f6' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const centralDownObstacle = Matter.Bodies.rectangle(400, 550, 90, 100, {
        isStatic: true,
        label: 'central_obstacle',
        render: { fillStyle: '#3b82f6' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      // 모든 요소를 월드에 추가
      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        redPlatform,
        greenRamp,
        centralUpObstacle,
        centralDownObstacle,
      ]);
    
      // 공을 참조
      ballRef.current = ball;

      // const world = engineRef.current.world;

      // const walls = [
      //   Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   } }),
      //   // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      // ];

      // const ball = Matter.Bodies.circle(150, 400, 15, {
      //   render: { fillStyle: '#ef4444' },
      //   label: 'ball',
      //   restitution: 0.3,
      //   friction: 0.05,
      //   frictionAir: 0.01,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });
      // initialBallPositionRef.current = { x: 150, y: 400 };

      // const horizontalDownPlatform = Matter.Bodies.rectangle(300, 450, 450, 150, {
      //   isStatic: true,
      //   label: 'horizontal_down_platform',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const horizontalUpPlatform = Matter.Bodies.rectangle(550, 200, 400, 20, {
      //   isStatic: true,
      //   label: 'horizontal_up_platform',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const star = Matter.Bodies.trapezoid(700, 180, 20, 20, 1, {
      //   render: { fillStyle: '#fbbf24' },
      //   label: 'balloon',
      //   isStatic: true,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0x0001,
      //   }
      // });

      // Matter.World.add(world, [
      //   ...walls,
      //   ball,
      //   star,
      //   horizontalDownPlatform,
      //   horizontalUpPlatform,
      // ]);

      // ballRef.current = ball;
    } else if (currentLevel === 8) {
      const world = engineRef.current.world;

      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];

      const ball = Matter.Bodies.circle(150, 400, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 150, y: 400 };

      const horizontalDownPlatform = Matter.Bodies.rectangle(150, 450, 200, 150, {
        isStatic: true,
        label: 'horizontal_down_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        },
      });

/*       const horizontalUpPlatform = Matter.Bodies.rectangle(550, 200, 400, 20, {
        isStatic: true,
        label: 'horizontal_up_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      }); */

      const star = Matter.Bodies.trapezoid(700, 350, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });

      // 못(nail) 생성
      const centerX7_0 = 230;
      const centerY7_0 = 410;
      const radius7 = 10;
      const nail7_0 = Matter.Bodies.circle(centerX7_0, centerY7_0, radius7, {
        isStatic: true,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail7_0', // Assign customId
        mass: 30,
      });

      // 못(nail)을 포함한 객체의 충돌 규칙 수정
      // targetBody.collisionFilter = {
      //   group: data.groupNumber,
      //   category: data.category, // Nail과 같은 카테고리
      //   mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
      // }

      socket.emit('registerPin', { centerX7_0, centerY7_0, radius7, playerId: 'player1', customId: 'nail7_0', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail7_0);

      const constraint7_0 = Matter.Constraint.create({
        bodyA: horizontalDownPlatform, // 도형
        pointA: { x: centerX7_0 - horizontalDownPlatform.position.x, y: centerY7_0 - horizontalDownPlatform.position.y }, // 도형 내부의 연결 지점
        bodyB: nail7_0, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      // 못(nail) 생성
      const centerX7_1 = 70;
      const centerY7_1 = 410;
      const nail7_1 = Matter.Bodies.circle(centerX7_1, centerY7_1, radius7, {
        isStatic: true,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail7_1', // Assign customId
        mass: 30,
      });

      // 못(nail)을 포함한 객체의 충돌 규칙 수정
      // targetBody.collisionFilter = {
      //   group: data.groupNumber,
      //   category: data.category, // Nail과 같은 카테고리
      //   mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
      // }

      socket.emit('registerPin', { centerX7_1, centerY7_1, radius7, playerId: 'player1', customId: 'nail7_1', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail7_1);

      const constraint7_1 = Matter.Constraint.create({
        bodyA: horizontalDownPlatform, // 도형
        pointA: { x: centerX7_1 - horizontalDownPlatform.position.x, y: centerY7_1 - horizontalDownPlatform.position.y }, // 도형 내부의 연결 지점
        bodyB: nail7_1, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        horizontalDownPlatform,
        nail7_0,
        constraint7_0,
        nail7_1,
        constraint7_1,
      ]);

      ballRef.current = ball;

      /***** Original *****/
      // const world = engineRef.current.world;

      // const walls = [
      //   Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   } }),
      //   // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      // ];

      // const ball = Matter.Bodies.circle(150, 400, 15, {
      //   render: { fillStyle: '#ef4444' },
      //   label: 'ball',
      //   restitution: 0.3,
      //   friction: 0.05,
      //   frictionAir: 0.01,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });
      // initialBallPositionRef.current = { x: 150, y: 400 };

      // const horizontalPlatform = Matter.Bodies.rectangle(150, 450, 200, 150, {
      //   isStatic: true,
      //   label: 'horizontal_down_platform',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const star = Matter.Bodies.trapezoid(700, 350, 20, 20, 1, {
      //   render: { fillStyle: '#fbbf24' },
      //   label: 'balloon',
      //   isStatic: true,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0x0001,
      //   }
      // });

      // Matter.World.add(world, [
      //   ...walls,
      //   ball,
      //   star,
      //   horizontalPlatform,
      // ]);

      // ballRef.current = ball;
    } else if (currentLevel === 9) {
      const world = engineRef.current.world;

      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];

      const ball = Matter.Bodies.circle(100, 490, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.01,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 80, y: 200 };

/*       const pillar1 = Matter.Bodies.rectangle(750, 500, 80, 200, {
        isStatic: true,
        label: 'pillar1',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const pillar2 = Matter.Bodies.rectangle(670, 550, 80, 170, {
        isStatic: true,
        label: 'pillar2',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const pillar3 = Matter.Bodies.rectangle(490, 550, 100, 170, {
        isStatic: true,
        label: 'pillar3',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });

      const slopeVertices = [];
      const radius = 450;
      const centerX = 30;
      const centerY = 410;
      const segmentCount = 30; // 둥근 정도를 조절하는 세그먼트 수

      // 정점 생성 (거꾸로 뒤집기 위해 Y 좌표 반전)
      for (let i = 0; i <= segmentCount; i++) {
        const angle = Math.PI * (i / segmentCount); // 반원을 30개로 나눔
        slopeVertices.push({
          x: centerX + radius * Math.cos(angle),
          y: centerY - radius * Math.sin(angle), // Y 좌표를 반전 (-를 추가)
        });
      }

      // fromVertices 함수에서 이중 배열로 감싸기
      const roundedSlope = Matter.Bodies.fromVertices(
        centerX,
        centerY,
        [slopeVertices], // <- 이중 배열로 감싸줍니다.
        {
          isStatic: true,
          render: { fillStyle: '#6b7280' },
          label: 'rounded_slope',
          collisionFilter: {
            category: 0x0001,
            mask: 0xFFFF,
          }
        },
        true // 자동 최적화
      ); */

      const floor = Matter.Bodies.rectangle(400, 550, 750, 80, {
        isStatic: true,
        label: 'floor',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        },
      });

      const Ishape = Matter.Bodies.rectangle(550, 295, 30, 390, {
        isStatic: false,
        label: 'Ishape',
        render: { fillStyle: '#4B0082' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        },
      });

      const upperrectangle = Matter.Bodies.rectangle(550, 85, 150, 30, {
        isStatic: false,
        label: 'upperrectangle',
        render: { fillStyle: '#4B0082' },
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        },
      });

      const Tshape = Matter.Body.create({
        parts: [upperrectangle, Ishape],
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail과 같은 카테고리
          mask: 0xFFFF & ~0x0002, // 같은 카테고리끼리 충돌하지 않도록 설정
        },
      });

      const star = Matter.Bodies.trapezoid(700, 495, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });

      // 못(nail) 생성
      const centerX8_0 = 550;
      const centerY8_0 = 120;
      const radius8 = 10;
      const nail8_0 = Matter.Bodies.circle(centerX8_0, centerY8_0, radius8, {
        isStatic: true,
        collisionFilter: {
          group: -1,
          category: 0x0002, // Nail의 카테고리
          mask: 0x0000,
        },
        render: {
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#fbbf24',
          lineWidth: 3,
        },
        label: 'nail8_0', // Assign customId
        mass: 30,
      });

      // 못(nail)을 포함한 객체의 충돌 규칙 수정
      // targetBody.collisionFilter = {
      //   group: data.groupNumber,
      //   category: data.category, // Nail과 같은 카테고리
      //   mask: 0xFFFF & ~data.category, // 같은 카테고리끼리 충돌하지 않도록 설정
      // }

      socket.emit('registerPin', { centerX8_0, centerY8_0, radius8, playerId: 'player1', customId: 'nail8_0', currentLevel});
      
      // 상태에 nail 추가
      addNail(nail8_0);

      const constraint8_0 = Matter.Constraint.create({
        bodyA: Tshape, // 도형
        pointA: { x: centerX8_0 - Tshape.position.x, y: centerY8_0 - Tshape.position.y }, // 도형 내부의 연결 지점
        bodyB: nail8_0, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      Matter.World.add(world, [
        ...walls,
        ball,
        star,
        floor,
        Tshape,
        nail8_0,
        constraint8_0,
        // slope,
        // pillar1,
        // pillar2,
        // pillar3,
        // roundedSlope,
      ]);

      ballRef.current = ball;
    } else if (currentLevel === 10) {
      const walls = [
        Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        } }),
        // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
        // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
        //   category: 0x0001,
        //   mask: 0xFFFF,
        // } }),
      ];
    
      // Ball setup
      const ball = Matter.Bodies.circle(150, 500, 15, {
        render: { fillStyle: '#ef4444' },
        label: 'ball',
        restitution: 0.3,
        friction: 0.05,
        frictionAir: 0.01,
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
      initialBallPositionRef.current = { x: 150, y: 500 };

      const horizontalPlatform = Matter.Bodies.rectangle(150, 550, 150, 100, {
        isStatic: true,
        label: 'horizontal_platform',
        render: { fillStyle: '#6b7280' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      // Star (Goal) setup
      const star = Matter.Bodies.trapezoid(600, 130, 20, 20, 1, {
        render: { fillStyle: '#fbbf24' },
        label: 'balloon',
        isStatic: true,
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,
        }
      });
    
      // Frame holding the star
      const frameTop = Matter.Bodies.rectangle(600, 80, 100, 25, {
        isStatic: true,
        label: 'frame_top',
        render: { fillStyle: '#94a3b8' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const frameLeft = Matter.Bodies.rectangle(550, 110, 25, 85, {
        isStatic: true,
        label: 'frame_left',
        render: { fillStyle: '#94a3b8' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      const frameRight = Matter.Bodies.rectangle(650, 110, 25, 85, {
        isStatic: true,
        label: 'frame_right',
        render: { fillStyle: '#94a3b8' },
        collisionFilter: {
          category: 0x0001,
          mask: 0xFFFF,
        }
      });
    
      // Adding everything to the world
      Matter.World.add(world, [
        ...walls,
        ball,
        horizontalPlatform,
        star,
        frameTop,
        frameLeft,
        frameRight,
      ]);
    
      ballRef.current = ball;
      
      // const world = engineRef.current.world;

      // const walls = [
      //   Matter.Bodies.rectangle(400, 610, 810, 20, { isStatic: true, label: 'wall_bottom', collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   } }),
      //   // Matter.Bodies.rectangle(400, -10, 810, 20, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(-10, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      //   // Matter.Bodies.rectangle(810, 300, 20, 620, { isStatic: true, label: 'wall', collisionFilter: {
      //   //   category: 0x0001,
      //   //   mask: 0xFFFF,
      //   // } }),
      // ];

      // const ball = Matter.Bodies.circle(80, 200, 15, {
      //   render: { fillStyle: '#ef4444' },
      //   label: 'ball',
      //   restitution: 0.3,
      //   friction: 0.01,
      //   frictionAir: 0.01,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });
      // initialBallPositionRef.current = { x: 80, y: 200 };

      // const pillar1 = Matter.Bodies.rectangle(750, 500, 80, 200, {
      //   isStatic: true,
      //   label: 'pillar1',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const pillar2 = Matter.Bodies.rectangle(670, 550, 80, 170, {
      //   isStatic: true,
      //   label: 'pillar2',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const pillar3 = Matter.Bodies.rectangle(490, 550, 100, 170, {
      //   isStatic: true,
      //   label: 'pillar3',
      //   render: { fillStyle: '#6b7280' },
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0xFFFF,
      //   }
      // });

      // const slopeVertices = [];
      // const radius = 450;
      // const centerX = 30;
      // const centerY = 410;
      // const segmentCount = 30; // 둥근 정도를 조절하는 세그먼트 수

      // // 정점 생성 (거꾸로 뒤집기 위해 Y 좌표 반전)
      // for (let i = 0; i <= segmentCount; i++) {
      //   const angle = Math.PI * (i / segmentCount); // 반원을 30개로 나눔
      //   slopeVertices.push({
      //     x: centerX + radius * Math.cos(angle),
      //     y: centerY - radius * Math.sin(angle), // Y 좌표를 반전 (-를 추가)
      //   });
      // }

      // // fromVertices 함수에서 이중 배열로 감싸기
      // const roundedSlope = Matter.Bodies.fromVertices(
      //   centerX,
      //   centerY,
      //   [slopeVertices], // <- 이중 배열로 감싸줍니다.
      //   {
      //     isStatic: true,
      //     render: { fillStyle: '#6b7280' },
      //     label: 'rounded_slope',
      //     collisionFilter: {
      //       category: 0x0001,
      //       mask: 0xFFFF,
      //     }
      //   },
      //   true // 자동 최적화
      // );

      // const star = Matter.Bodies.trapezoid(750, 380, 20, 20, 1, {
      //   render: { fillStyle: '#fbbf24' },
      //   label: 'balloon',
      //   isStatic: true,
      //   collisionFilter: {
      //     category: 0x0001,
      //     mask: 0x0001,
      //   }
      // });

      // Matter.World.add(world, [
      //   ...walls,
      //   ball,
      //   star,
      //   // slope,
      //   pillar1,
      //   pillar2,
      //   pillar3,
      //   roundedSlope,
      // ]);

      // ballRef.current = ball;
    }

    Matter.Events.on(engineRef.current, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        if (
          (pair.bodyA.label === 'ball' && pair.bodyB.label === 'balloon') ||
          (pair.bodyA.label === 'balloon' && pair.bodyB.label === 'ball')
        ) {
          setGameEnded(true);
        }
      });
    });

    // 공이 wall_bottom 아래로 떨어졌는지 확인
    Matter.Events.on(engineRef.current, 'afterUpdate', () => {
      const threshold = 40; // 공 및 사물 삭제 기준 높이
      const world = engineRef.current.world;

      // wall_bottom을 초기화 시점에 찾음
      const wallBottom = Matter.Composite.allBodies(world).find((body) => body.label === 'wall_bottom');
      if (!wallBottom) {
        console.error('Wall bottom not found!');
        return;
      }
      const bodies = Matter.Composite.allBodies(world);

      if (ballRef.current) {
        const ball = ballRef.current;
        const wallBottom = Matter.Composite.allBodies(world).find(
          (body) => body.label === 'wall_bottom'
        );
    
        if (!wallBottom) {
          console.error('Wall bottom not found!');
          return;
        }
    
        // console.log(`Ball Y: ${ball.position.y}, Wall Bottom Max Y: ${wallBottom.bounds.max.y}`);
        // console.log(`Ball X: ${ball.position.x}, Ball Y: ${ball.position.y}`);
        // const threshold = 40;
        // console.log("currentLevel: ", currentLevel)
        if (ball.position.y > wallBottom.bounds.max.y - threshold) {
          // console.log('Ball fell below the wall. Resetting position.');
          // 초기 위치로 이동
          Matter.Body.setPosition(ball, initialBallPositionRef.current);

          // 속도 초기화
          Matter.Body.setVelocity(ball, { x: 0, y: 0 });

          // 힘 초기화 (필요하면 추가)
          Matter.Body.setAngularVelocity(ball, 0);
          Matter.Body.applyForce(ball, ball.position, { x: 0, y: 0 });
        }
      }

      // 사용자 사물이 화면 아래로 떨어지면 서서히 삭제
      bodies.forEach((body) => {
        const wallBottom = bodies.find((b) => b.label === 'wall_bottom');
        if (!wallBottom) return;

        // 충돌한 사물의 `opacity` 감소
        if (!staticObjects.includes(body.label) && !body.isStatic) {
          const isTouchingFloor = Matter.SAT.collides(body, wallBottom)?.collided;

          if (isTouchingFloor) {
            body.render.opacity = body.render.opacity ?? 1; // 초기값 설정
            body.render.opacity -= 0.01; // 점진적으로 투명도 감소

            if (body.render.opacity <= 0) {
              socket.emit('erase', {
                customId: body.label,
                playerId: 'player1',
                currentLevel,
                isRelease: false,
              });
              // Matter.World.remove(world, body); // 완전히 투명해지면 제거
            }
          }
        }
      });
    });

    // 정리 함수
    return () => {
      if (renderRef.current) Matter.Render.stop(renderRef.current);
      if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
      Matter.World.clear(world, false);
      Matter.Engine.clear(engineRef.current);
    }

    // Matter.Runner.run(engineRef.current);
    // Matter.Render.run(render);

    // return () => {
    //   Matter.Render.stop(render);
    //   Matter.World.clear(world, false);
    //   Matter.Engine.clear(engineRef.current);
    // };
  }, [currentLevel, resetTrigger]);

  // 헬퍼 함수: 클릭 좌표와 선분(Constraint의 끝점) 사이의 최단 거리를 계산
  const distancePointToLineSegment = (
    point: { x: number; y: number },
    segA: { x: number; y: number },
    segB: { x: number; y: number }
  ): number => {
    const { x: x0, y: y0 } = point;
    const { x: x1, y: y1 } = segA;
    const { x: x2, y: y2 } = segB;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq === 0) return Math.hypot(x0 - x1, y0 - y1);
    let t = ((x0 - x1) * dx + (y0 - y1) * dy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(x0 - cx, y0 - cy);
  };

  // 헬퍼 함수: Constraint의 endpoint(월드 좌표)를 반환
  const getConstraintEndpoint = (
    constraint: Matter.Constraint,
    which: "A" | "B"
  ): { x: number; y: number } | null => {
    const body = which === "A" ? constraint.bodyA : constraint.bodyB;
    const pt = which === "A" ? constraint.pointA : constraint.pointB;
    if (body) {
      return { x: body.position.x + (pt?.x || 0), y: body.position.y + (pt?.y || 0) };
    } else if (pt) {
      return { x: pt.x, y: pt.y };
    }
    return null;
  };

  // 헬퍼 함수: 클릭 좌표(mousePos) 근처(임계값 이하)에 위치하면서 label이 "chain"으로 시작하는 Constraint 반환
  const getChainConstraintsNearPoint = (
    mousePos: { x: number; y: number },
    world: Matter.World,
    threshold: number = 5
  ): Matter.Constraint[] => {
    const allConstraints = Matter.Composite.allConstraints(world);
    return allConstraints.filter(constraint => {
      // 반드시 constraint의 label이 "chain"으로 시작해야 함
      if (!constraint.label || !constraint.label.startsWith("chain")) return false;

      const pA = getConstraintEndpoint(constraint, "A");
      const pB = getConstraintEndpoint(constraint, "B");
      if (!pA || !pB) return false;
      const dist = distancePointToLineSegment(mousePos, pA, pB);
      return dist <= threshold;
    });
  };

  const createPhysicsBody = (points: Matter.Vector[], myGenerated: boolean, collisionCategory: number, groupNumber: number, customId?: string) => {
    console.log("customId: ", customId);
    if (points.length < 2) return null;
    console.log("object generated");

    if(myGenerated) {
      // console.log("myGenerated True, points: ", points)
      console.log("myGenerated True, collisionCategory: ", collisionCategory)
    } else {
      // console.log("myGenerated False, points: ", points)
      console.log("myGenerated False, collisionCategory: ", collisionCategory)
    }

    if (myGenerated) {
      const logInfo: LogInfo = {
        player_number: currentTurn === "player1" ? 1 : 2,
        type: 'draw',
        timestamp: new Date(),
      };
      // saveLog(logInfo);
    }
  
    // Simplify the path to reduce physics complexity
    const simplified = points.filter((point, index) => {
      if (index === 0 || index === points.length - 1) return true;
      const prev = points[index - 1];
      const dist = Math.hypot(point.x - prev.x, point.y - prev.y);
      return dist > 2;
    });

    if(myGenerated) {
      console.log("myGenerated True, nails: ", nails)
    } else {
      console.log("myGenerated False, nails: ", nails)
    }

    if(myGenerated) {
      console.log("myGenerated True, groupNumber: ", groupNumber)
    } else {
      console.log("myGenerated False, groupNumber: ", groupNumber)
    }

    // Nail 검출: points와의 접점이 있는 nail 찾기
    const nailsInShape: Matter.Body[] = nailsRef.current.filter((nail) => {
      const shapeBounds = Matter.Bounds.create(simplified); // 도형의 경계 생성
      console.log("overlapasdfsdffds: ", Matter.Bounds.overlaps(nail.bounds, shapeBounds));
      return Matter.Bounds.overlaps(nail.bounds, shapeBounds); // nail과 도형의 경계 비교
    });

    console.log("nailsInShape(sdfadfsfds): ", nailsInShape);

    if (!myGenerated && nailsInShape.length > 0) {
      console.log("Detected ${nailsInShape.length} nails inside the shape.");
    }

    // **핀 로직 수정**
    if (tool === 'pin') {
      // 중심점 계산: points를 기반으로
      const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

      // 최대 반경 계산: points를 기반으로
      const radius = Math.max(
        ...points.map(p => Math.hypot(p.x - centerX, p.y - centerY))
      );

      // 클릭 위치에 존재하는 사물을 찾음
      const mousePosition = { x: centerX, y: centerY };
      const bodies = Matter.Composite.allBodies(engineRef.current.world);
      const targetBody = bodies.find((body) =>
        Matter.Bounds.contains(body.bounds, mousePosition) 
        // && !staticObjects.includes(body.label) // 고정된 사물은 제외
      );

      // 사물이 없으면 못을 생성하지 않음
      if (!targetBody) {
        console.log("No body found under the nail position.");
        return null;
      }

      const constraints = Matter.Composite.allConstraints(engineRef.current.world); // 모든 제약 조건 가져오기

      // targetBody에 연결된 constraints 찾기
      const connectedConstraints = constraints.filter(
        (constraint) =>
          constraint.bodyA === targetBody
      );

      const nailGroupNumber = connectedConstraints[0]?.bodyB?.collisionFilter.group;
      const nailCategory = connectedConstraints[0]?.bodyB?.collisionFilter.category;

      // 못(nail) 생성
      const nail = Matter.Bodies.circle(centerX, centerY, radius, {
        isStatic: targetBody.isStatic ? true : false,
        // collisionFilter: {
        //   category: 0x0002, // Nail의 카테고리
        //   mask: 0x0000,     // 어떤 것도 충돌하지 않도록 설정
        // },
        render: {
          // fillStyle: '#ef4444', // 못의 색상
          fillStyle: 'rgba(0, 0, 0, 0.0)', // 못의 색상
          strokeStyle: '#ef4444', // 못의 색상
          lineWidth: 2,
          // layer: 1,
        },
        label: customId || `nail_${Date.now()}`, // Assign customId
      });

      // 상태에 nail 추가
      // addNail(nail);
      console.log("sdfnail: ", nail);
      console.log("sdfnails: ", nails);
      
      // Matter.js 월드에 nail 추가
      // Matter.Composite.add(engineRef.current.world, nail);

      // 도형(targetBody)와 못(nail)을 Constraint로 연결
      const constraint = Matter.Constraint.create({
        bodyA: targetBody, // 도형
        pointA: { x: mousePosition.x - targetBody.position.x, y: mousePosition.y - targetBody.position.y }, // 도형 내부의 연결 지점
        bodyB: nail, // 못
        pointB: { x: 0, y: 0 }, // 못의 중심
        stiffness: 1, // 강성(도형과 못의 연결 강도)
        length: 0, // 길이 (0으로 설정해 못이 도형에 붙어 있게 함)
        render: {
          visible: false, // Constraint 시각화를 비활성화
        },
      });

      // Matter.js 월드에 Constraint 추가
      // Matter.Composite.add(engineRef.current.world, constraint);

      if (myGenerated && !customId) {
        console.log("핀 데이터를 서버로 전송");

        // 핀 데이터를 서버로 전송
        const customId = nail.label;
        socket.emit('drawPin', { centerX, centerY, radius, points: points, playerId: 'player1', customId, currentLevel, targetBodyCustomId: targetBody.label, nailGroupNumber, nailCategory});
      }

      // return {body: nail, nailsInShape: []};
      return nail;
    }
  
    // Check if points are in a nearly straight line by comparing distances
    // if (simplified.length === 2) {
    //   const [start, end] = simplified;
    //   const distance = Math.hypot(end.x - start.x, end.y - start.y);
    //   const angle = Math.atan2(end.y - start.y, end.x - start.x);
  
    //   // Create a thin rectangle to represent the line
    //   // return {body: Matter.Bodies.rectangle(
    //   //   (start.x + end.x) / 2, // Center X
    //   //   (start.y + end.y) / 2, // Center Y
    //   //   distance, // Width of the line (distance between points)
    //   //   2, // Very small height to simulate a line
    //   //   {
    //   //     angle,
    //   //     render: {
    //   //       fillStyle: '#3b82f6',
    //   //       strokeStyle: '#1d4ed8',
    //   //       lineWidth: 1,
    //   //     },
    //   //     isStatic: false, // 사물이 떨어지도록 설정
    //   //     friction: 0.8,
    //   //     frictionStatic: 1,
    //   //     restitution: 0.2,
    //   //     density: 0.01,
    //   //     label: customId || `custom_${Date.now()}`, // Assign customId
    //   //     collisionFilter: {
    //   //       category: 0x0001,
    //   //       mask: 0xFFFF,
    //   //     }
    //   //   }
    //   // ), nailsInShape: []};
    //   return Matter.Bodies.rectangle(
    //     (start.x + end.x) / 2, // Center X
    //     (start.y + end.y) / 2, // Center Y
    //     distance, // Width of the line (distance between points)
    //     2, // Very small height to simulate a line
    //     {
    //       angle,
    //       render: {
    //         fillStyle: '#3b82f6',
    //         strokeStyle: '#1d4ed8',
    //         lineWidth: 1,
    //       },
    //       isStatic: false, // 사물이 떨어지도록 설정
    //       friction: 0.8,
    //       frictionStatic: 1,
    //       restitution: 0.2,
    //       density: 0.01,
    //       label: customId || `custom_${Date.now()}`, // Assign customId
    //       collisionFilter: {
    //         category: collisionCategory,
    //         mask: ~collisionCategory,
    //       }
    //     }
    //   );
    // }
  
    // For shapes with more points, create a closed polygonal body
    // 기존 nail들의 category 값 가져오기
    const existingCategories = nailsRef.current
    .map((nail) => nail.collisionFilter.category)
    .filter((category): category is number => category !== undefined || category === collisionCategory);

    // 기존 nail들의 category 값을 |로 연결
    const additionalMask = existingCategories.reduce(
      (mask, category) => mask | category,
      0x0000 // 초기값 0
    );

    const vertices = [...simplified];
    if (vertices.length >= 3) {
      const bodyOptions = {
        render: {
          // fillStyle: '#3b82f6',
          fillStyle: 'rgba(0, 0, 0, 0.0)',
          strokeStyle: '#1d4ed8',
          lineWidth: 1,
        },
        isStatic: false, // 사물이 떨어지도록 설정
        friction: 0.8,
        frictionStatic: 1,
        restitution: 0.2,
        density: 0.005, // 밀도를 낮추어 떨어지는 속도를 줄임
        frictionAir: 0.02, // 공중 저항을 높임
        label: customId || `custom_${Date.now()}`, // Assign customId
        collisionFilter: {
          group: groupNumber,
          category: collisionCategory,
          // mask: collisionCategory === 0x0001 ? 0xFFFF : (0xFFFF & ~collisionCategory) | 0x0001, // 같은 카테고리끼리 충돌하지 않도록 설정,
          // mask: collisionCategory === 0x0001 ? 0xFFFE : (0xFFFF & ~collisionCategory), // 같은 카테고리끼리 충돌하지 않도록 설정,
          // mask: collisionCategory === 0x0001 ? 0xFFFF : (0xFFFF & ~collisionCategory) | 0x0001 | additionalMask, // 같은 카테고리끼리 충돌하지 않도록 설정,
          mask: collisionCategory === 0x0001 ? 0xFFFF : (0xFFFF & ~collisionCategory), // 같은 카테고리끼리 충돌하지 않도록 설정,
        },
      };
      
      if(myGenerated) {
        console.log("myGenerated True, bodyOptions: ", bodyOptions)
      } else {
        console.log("myGenerated False, bodyOptions: ", bodyOptions)
      }
  
      // Use the center of mass as the initial position
      const centroidX = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
      const centroidY = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length;
  
      const translatedVertices = vertices.map(v => ({
        x: v.x - centroidX,
        y: v.y - centroidY,
      }));
  
      const body = Matter.Bodies.fromVertices(centroidX, centroidY, [translatedVertices], {
        ...bodyOptions,
        // collisionFilter: (nailsInShape.length > 0 && !myGenerated) ? {
        //   category: 0x0004, // body의 카테고리
        //   mask: 0x0000, // 어떤 것도 충돌하지 않도록 설정
        // } : {
        //   category: 0x0002, // 기본 카테고리
        //   mask: 0xFFFF, // 모든 것과 충돌
        // },
      });

      if (currentLevel === 3) {
        Matter.Body.setAngularVelocity(body, -0.05);
      }

      if (body && myGenerated && !customId) {
        console.log("도형 데이터를 서버로 전송")
        // 도형 데이터를 서버로 전송
        const customId = body.label; // Use the label as the customId

        // nailsInShape를 단순화하여 전송
        // const simplifiedNailsInShape = nailsInShape.map(nail => ({
        //   label: nail.label,
        //   position: nail.position,
        //   collisionFilter: nail.collisionFilter,
        // }));

        // socket.emit('drawShape', { points: simplified, playerId: 'player1', customId, currentLevel, nailsInShape: simplifiedNailsInShape });
        const nailsIdString = nailsInShape
        .map(nail => nail.label)  // nail.label이 customId라 가정
        .join(';');
        const nailCollisionCategory = nailsInShape[0]?.collisionFilter.category;
        const nailGroupNumber = nailsInShape[0]?.collisionFilter.group;
        if(nailCollisionCategory) {
          socket.emit('drawShape', { points: simplified, playerId: 'player1', customId, currentLevel, nailsIdString, collisionCategory: nailCollisionCategory, groupNumber: nailGroupNumber });
        } else {
          socket.emit('drawShape', { points: simplified, playerId: 'player1', customId, currentLevel });
        }
      }

      return {body, nailsInShape};
    }
  
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    // console.log("rect.left: ", rect.left)
    // console.log("rect.right: ", rect.right)
    // console.log("rect.top: ", rect.top)
    // console.log("rect.bottom: ", rect.bottom)
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    
    if (tool === 'chain') {
      // 클릭 위치에 있는 Body 중 label이 'nail'로 시작하는 것만 찾음
      const bodies = Matter.Query.point(
        Matter.Composite.allBodies(engineRef.current.world),
        point
      );
      const pin = bodies.find(body => body.label.startsWith('nail'));

      if (pin) {
        setSelectedPins(prevPins => {
          // 같은 pin이 이미 포함되었으면 추가하지 않음
          if (prevPins.includes(pin)) return [...prevPins];
          const newPins = [...prevPins, pin];

          // 만약 두 개의 핀이 선택되면 체인 생성
          if (newPins.length === 2) {
            // 만약 이미 chain emit이 이루어진 상태라면 반환 (중복 방지)
            if (chainEmittedRef.current) {
              return [];
            }
            const [pinA, pinB] = newPins;

            // 임의의 customId 부여 (예: chain_타임스탬프)
            const customId = `chain_${Date.now()}`;
            socket.emit('createChain', {
              playerId: 'player1',
              customId,
              pinAId: pinA.label, // 예: 'nail_123'
              pinBId: pinB.label, // 예: 'nail_456'
              stiffness: 0.0001,
              damping: 0.00001,
              length: Matter.Vector.magnitude(
                Matter.Vector.sub(pinB.position, pinA.position)
              ) * 1.1,
              currentLevel,
            });

            socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
            
            // 체인 생성 이벤트가 한 번 실행된 것으로 플래그 설정
            chainEmittedRef.current = true;

            // Optional: 일정 시간 후 다시 초기화 (예: 500ms 후)
            setTimeout(() => {
              chainEmittedRef.current = false;
            }, 500);

            // 선택한 핀 상태 초기화
            return [];
          }
          return newPins;
        });
      }
      return;
    }

    // if (tool === 'chain') {
    //   // 클릭 지점에 있는 바디(못)들을 가져온다.
    //   const bodies = Matter.Query.point(
    //     Matter.Composite.allBodies(engineRef.current.world),
    //     point
    //   );
    //   const pin = bodies.find(body => body.label.startsWith('nail'));
      
    //   if (pin) {
    //     setSelectedPins(prevPins => {
    //       const newPins = [...prevPins, pin];
          
    //       // 핀이 두 개 선택되면 다중 세그먼트(로프) 생성
    //       if (newPins.length === 2) {
    //         const [pinA, pinB] = newPins;
    
    //         // 두 핀 사이 거리 계산
    //         const dist = Matter.Vector.magnitude(
    //           Matter.Vector.sub(pinB.position, pinA.position)
    //         );
    
    //         // -------------------------
    //         // 1) "로프"를 구성할 세그먼트 바디들 만들기
    //         // -------------------------
    //         const segments = 10; // 만들고 싶은 세그먼트 개수
    //         const ropeBodies: Matter.Body[] = [];
    
    //         // pinA ~ pinB를 기준으로 등분하여 세그먼트 위치 설정
    //         for (let i = 0; i < segments; i++) {
    //           const t = i / (segments - 1); // 0 ~ 1 사이
    
    //           // 보간(Interpolate)으로 각 세그먼트 위치 결정
    //           const x = pinA.position.x + (pinB.position.x - pinA.position.x) * t;
    //           const y = pinA.position.y + (pinB.position.y - pinA.position.y) * t;
    
    //           // 작은 circle(혹은 rectangle) 바디 생성
    //           const segmentBody = Matter.Bodies.circle(x, y, 3, {
    //             label: 'ropeSegment',
    //             // 움직일 수 있어야 하므로 isStatic: false (기본값)
    //             frictionAir: 0.01, // 공기저항 등을 살짝 넣어볼 수 있음
    //           });
    
    //           ropeBodies.push(segmentBody);
    //         }
    
    //         // 2) World에 세그먼트 바디들 추가
    //         Matter.World.add(engineRef.current.world, ropeBodies);
    
    //         // -------------------------
    //         // 3) 인접한 세그먼트끼리 스프링(Constraint)으로 연결
    //         // -------------------------
    //         for (let i = 0; i < ropeBodies.length - 1; i++) {
    //           const bodyA = ropeBodies[i];
    //           const bodyB = ropeBodies[i + 1];
    
    //           const link = Matter.Constraint.create({
    //             bodyA,
    //             bodyB,
    //             length: Matter.Vector.magnitude(
    //               Matter.Vector.sub(bodyB.position, bodyA.position)
    //             ),
    //             stiffness: 0.0001, // 줄처럼 아주 부드럽게
    //             damping: 0.1,      // 흔들림 감쇠
    //             render: {
    //               visible: true,
    //               lineWidth: 2,
    //               strokeStyle: '#444',
    //             },
    //           });
    //           Matter.World.add(engineRef.current.world, link);
    //         }
    
    //         // -------------------------
    //         // 4) 로프의 맨 앞(0번 세그먼트)과 맨 뒤(마지막 세그먼트)를
    //         //    각 핀(pin)에 '별도 Constraint'로 고정
    //         // -------------------------
    //         const firstSegment = ropeBodies[0];
    //         const lastSegment = ropeBodies[ropeBodies.length - 1];
    
    //         const constraintA = Matter.Constraint.create({
    //           bodyA: pinA,
    //           bodyB: firstSegment,
    //           length: 0,   // 거의 붙어있도록
    //           stiffness: 1 // 고정
    //         });
    
    //         const constraintB = Matter.Constraint.create({
    //           bodyA: pinB,
    //           bodyB: lastSegment,
    //           length: 0,
    //           stiffness: 1
    //         });
    
    //         // 월드에 추가
    //         Matter.World.add(engineRef.current.world, [constraintA]);
    
    //         // 선택된 핀 배열 초기화
    //         setSelectedPins([]);
    
    //         // 턴 교체 (게임 로직에 맞게 유지)
    //         socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
    //       }
          
    //       return newPins;
    //     });
    //   }
      
    //   return;
    // }

    if (tool === 'eraser') {
      if(currentTurn === 'player2') return;
      const bodies = Matter.Composite.allBodies(engineRef.current.world);
      const mousePosition = { x: point.x, y: point.y };

      console.log("bodies: ", bodies);

      // 1) point-query로 현재 좌표(mousePosition)에 있는 모든 Body 가져오기
      const bodiesAtPoint = Matter.Query.point(
        Matter.Composite.allBodies(engineRef.current.world),
        mousePosition
      );

      // 2) 그 중에서 label이 'nail'로 시작하는 Body만 찾기
      const nailBodies = bodiesAtPoint.filter(body => 
        body.label && body.label.startsWith('nail')
      );

      // Constraint 중에서, 클릭 위치(mousePosition) 근처에 있고 label이 "chain"으로 시작하는 Constraint를 찾기
      const nearChainConstraints = getChainConstraintsNearPoint(
        mousePosition,
        engineRef.current.world,
        5  // 허용 임계값 (픽셀 단위, 필요에 따라 조정)
      );

      if (nearChainConstraints.length > 0) {
        // Constraint가 있으면 첫 번째 Constraint를 대상으로 처리
        const targetConstraint = nearChainConstraints[0];
        console.log("Erasing chain constraint:", targetConstraint);
    
        // customId는 해당 Constraint의 label을 사용 (사전에 chain Constraint 생성 시 label이 "chain_..." 형태로 설정되어 있어야 함)
        const customId = targetConstraint.label;
    
        // 서버에 삭제 요청 전송
        socket.emit('erase', {
          customId,
          playerId: 'player1',
          currentLevel,
          isRelease: false,
        });
    
        // 턴 변경 전송
        socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
        return;
      }

      if(nailBodies.length > 0) {
        const customId = nailBodies[0].label;
        // 서버에 삭제 요청 전송
        socket.emit('erase', {
          customId,
          playerId: 'player1',
          currentLevel,
          isRelease: false,
        });

        socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
      } else {
        for (let body of bodies) {
          if (Matter.Bounds.contains(body.bounds, mousePosition) &&
              !staticObjects.includes(body.label)) {
            console.log("body.label: ", body.label)
            // Matter.World.remove(engineRef.current.world, body);
  
            const customId = body.label; // Use customId for deletion
            // Matter.World.remove(engineRef.current.world, body);
            
            // 서버에 삭제 요청 전송
            socket.emit('erase', {
              customId,
              playerId: 'player1',
              currentLevel,
            });
            
  
            socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
  
            // 턴 전환 로직
            // setCurrentTurn((prevTurn) => (prevTurn === "player1" ? "player2" : "player1"));
            
            const logInfo: LogInfo = {
              player_number: currentTurn === "player1" ? 1 : 2,
              type: 'erase',
              timestamp: new Date(),
            };
            // saveLog(logInfo);
  
            break;
          }
        }
      }
      return;
    }
    console.log("pushLock: ", pushLock);

    // if (tool === 'push' && ballRef.current && !pushLock) {
    if (tool === 'push' && ballRef.current) {
      // push 남용 방지
      // setPushLock(true);
      if(currentTurn === 'player2') return;
      
      const logInfo: LogInfo = {
        player_number: currentTurn === "player1" ? 1 : 2,
        type: 'push',
        timestamp: new Date(),
      };
      // saveLog(logInfo);

      // 턴 전환 로직
      // setCurrentTurn((prevTurn) => (prevTurn === "player1" ? "player2" : "player1"));

      const ball = ballRef.current;
      const ballX = ball.position.x;

      // 공의 중심에서 클릭한 위치까지의 거리 계산
      const clickOffsetX = point.x - ballX;

      // 클릭한 위치가 공의 왼쪽인지 오른쪽인지 판단
      // if (clickOffsetX < 0) {
      //   // 왼쪽을 클릭하면 오른쪽으로 힘을 가함
      //   Matter.Body.applyForce(ball, ball.position, { x: 0.008, y: 0 });
      // } else {
      //   // 오른쪽을 클릭하면 왼쪽으로 힘을 가함
      //   Matter.Body.applyForce(ball, ball.position, { x: -0.008, y: 0 });
      // }
      const force = clickOffsetX < 0 ? { x: 0.008, y: 0 } : { x: -0.008, y: 0 };

      // 공에 힘을 가함
      // Matter.Body.applyForce(ball, ball.position, force);

      // 서버에 힘 적용 요청 전송
      socket.emit('push', {
        force,
        playerId: 'player1',
        currentLevel
      });

      // socket.emit('changeTurn', { nextPlayerId: 'player2', currentLevel });
    }

    if(currentTurn === 'player1') {
      setIsDrawing(true);
      setDrawPoints([point]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
  
    const rect = canvasRef.current.getBoundingClientRect();
    let point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    // 서버로 마우스 위치 전송
    socket.emit('mouseMove', { x: point.x, y: point.y, playerId: 'player1' });

    if(!isDrawing || tool === 'eraser') return;

    // console.log("point.y: ", point.y)
    // console.log("rect.left: ", rect.left)
    // console.log("rect.right: ", rect.right)
    // console.log("rect.top: ", rect.top)
    // console.log("rect.bottom: ", rect.bottom)
  
    // // 캔버스 경계 안에 point를 제한
    // point = {
    //   x: Math.max(0, Math.min(point.x, 802)), 
    //   y: Math.max(0, Math.min(point.y, 602)), 
    // };

    // 캔버스 경계 안에 point를 제한
    point = {
      x: Math.max(0, Math.min(point.x, rect.width)), 
      y: Math.max(0, Math.min(point.y, rect.height)), 
    };
  
    // 벽과의 충돌 감지
    const bodies = Matter.Query.point(Matter.Composite.allBodies(engineRef.current.world), point);
    const collidedWall = bodies.find(body => body.label === 'wall');
    // console.log("collidedWall: ", collidedWall)
  
    if (collidedWall) {
      // 충돌한 벽의 경계 찾기
      const bounds = collidedWall.bounds;
  
      // 벽의 각 변과 점 사이의 거리 계산
      const distances = [
        Math.abs(point.x - bounds.min.x), // 왼쪽 변
        Math.abs(point.x - bounds.max.x), // 오른쪽 변
        Math.abs(point.y - bounds.min.y), // 위쪽 변
        Math.abs(point.y - bounds.max.y), // 아래쪽 변
      ];
  
      // 가장 가까운 변 찾기
      const minDistance = Math.min(...distances);
      // console.log("minDistance: ", minDistance)
      const threshold = 5; // 벽과의 거리 임계값
  
      if (minDistance < threshold) {
      if (distances[0] === minDistance) point.x = bounds.min.x; // 왼쪽 변
      else if (distances[1] === minDistance) point.x = bounds.max.x; // 오른쪽 변
      else if (distances[2] === minDistance) point.y = bounds.min.y; // 위쪽 변
      else if (distances[3] === minDistance) point.y = bounds.max.y; // 아래쪽 변
      }
    }
  
    const lastPoint = drawPoints[drawPoints.length - 1];
    // console.log("lastPoint: ", lastPoint)
    const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  
    if (dist > 5) {
      setDrawPoints(prev => [...prev, point]);
    }
  };
  
  const handleMouseUp = () => {
    // if (tool === 'eraser' || drawPoints.length < 2) {
    //   setIsDrawing(false);
    //   setDrawPoints([]);

    //   return;
    // }
  
    if (tool === 'pen' || tool === 'pin') {
      if(currentTurn === 'player2') return;
      console.log("asdfkjsdlfjksld")
      const body = createPhysicsBody(drawPoints, true, 0x0001, 0);
      if (body) {
        // Matter.World.add(engineRef.current.world, body);
        
        socket.emit('changeTurn', { nextPlayerId: 'player2' });
        // 턴 전환 로직
        // setCurrentTurn((prevTurn) => (prevTurn === "player1" ? "player2" : "player1"));
      }
    }
  
    setIsDrawing(false);
    setDrawPoints([]);
  };

  const handleToolChange = (newTool: 'pen' | 'eraser' | 'pin' | 'chain' | 'push') => {
    if (currentTurn === 'player2') return;
    setTool(newTool);
    setIsDrawing(false);
    setDrawPoints([]);

    // Clear the selected pins
    setSelectedPins([]);

    // 서버로 tool 변경 전송
    socket.emit('changeTool', { tool: newTool, playerId: 'player1', currentLevel });
  };

  // const handleLevelChange = (direction: 'prev' | 'next') => {
  //   setCurrentLevel(prev => direction === 'next' ? prev + 1 : Math.max(1, prev - 1));
  // };
  const handleLevelChange = (direction: 'prev' | 'next') => {
    if (direction === 'next') {
      if (currentLevel < TOTAL_LEVELS) {
        const newLevel = currentLevel + 1;
        // setCurrentLevel(prev => prev + 1);
        // setGameEnded(false); // 게임 종료 상태 초기화

        const logInfo: LogInfo = {
          player_number: currentTurn === "player1" ? 1 : 2,
          type: 'move_next_level',
          timestamp: new Date(),
        };
        // saveLog(logInfo)
        
        // 서버로 레벨 변경 전송
        socket.emit('changeLevel', { level: newLevel, currentLevel, direction, playerId: 'player1' });
      } else {
        // showTemporaryMessage("실험이 마지막 스테이지입니다");
      }
    } else {
      if (currentLevel > 1) {
        const newLevel = currentLevel - 1;
        // setCurrentLevel(prev => prev - 1);
        
        const logInfo: LogInfo = {
          player_number: currentTurn === "player1" ? 1 : 2,
          type: 'move_prev_level',
          timestamp: new Date(),
        };
        // saveLog(logInfo)
        
        // 서버로 레벨 변경 전송
        socket.emit('changeLevel', { type: 'move_prev_level', level: newLevel, direction, playerId: 'player1', currentLevel, newLevel });
      } else {
        // showTemporaryMessage("첫 스테이지입니다");
      }
    }
  };

  const handleNextLevel = () => {
    if (currentLevel < TOTAL_LEVELS) {
      const newLevel = currentLevel + 1
      // setCurrentLevel((prevLevel) => prevLevel + 1)
      setGameEnded(false); // 게임 종료 상태 초기화

      // 서버로 레벨 변경 전송
      socket.emit('changeLevel', { level: newLevel, playerId: 'player1' });
    } else {
      // setCurrentLevel((prevLevel) => prevLevel)
      setGameEnded(false); // 게임 종료 상태 초기화
    }
  }

  const resetLevel = () => {
    // setResetTrigger((prev) => !prev);

    // // 월드와 렌더를 정지하고 지운 후, 다시 설정
    // const world = engineRef.current.world;
    // Matter.World.clear(world, false);
    // Matter.Engine.clear(engineRef.current);
  
    // // 맵 초기화 - 렌더도 초기화하여 재설정
    // if (renderRef.current) {
    //   Matter.Render.stop(renderRef.current);
    //   Matter.Render.run(renderRef.current);
    // }
    
    // 현재 레벨에 대한 설정을 다시 불러옴
    // setCurrentLevel(currentLevel); // 이로 인해 useEffect가 실행됨

    const logInfo: LogInfo = {
      player_number: currentTurn === "player1" ? 1 : 2,
      type: 'refresh',
      timestamp: new Date(),
    };
    // saveLog(logInfo);

    // 서버로 초기화 이벤트 전송
    socket.emit('resetLevel', { playerId: 'player1', level: currentLevel });
  };

  // 누적해서 csv 파일 업데이트
  const saveLog = async (logInfo: LogInfo) => {
    try {
      console.log("ddd: ", {
        player_number: logInfo.player_number,
        type: logInfo.type,
        timestamp: logInfo.timestamp.toISOString(), // Convert timestamp to ISO format
      })
      // await axios.post('http://ec2-13-125-215-243.ap-northeast-2.compute.amazonaws.com:3000/logger/log', {
      //   player_number: logInfo.player_number,
      //   type: logInfo.type,
      //   timestamp: logInfo.timestamp.toISOString(), // Convert timestamp to ISO format
      // });
      await axios.post('http://localhost:3000/logger/log', {
        player_number: logInfo.player_number,
        type: logInfo.type,
        timestamp: logInfo.timestamp.toISOString(), // Convert timestamp to ISO format
      });
      console.log('Log saved successfully');
    } catch (error) {
      console.error('Failed to save log:', error);
    }
  }

  const drawOtherPlayerCursor = (x: number, y: number, playerId: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
    ctx.fillStyle = playerId === 'player1' ? 'blue' : 'red'; // 플레이어에 따라 색상 다르게
    ctx.fill();
  };
  
  const handleButtonClick = () => {
    console.log('Current cursors length:', cursors.length);
  };

  const handleShowBodies = () => {
    if (!engineRef.current) return;
    const allBodies = Matter.Composite.allBodies(engineRef.current.world);
    console.log("All Bodies:", allBodies);
  };

  return (
    // <div>
    //   {isFinished ? (
    //     // 팝업 화면
    //     <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-75 z-50">
    //       <div className="bg-white p-8 rounded-lg shadow-lg text-center">
    //         <h2 className="text-2xl font-bold mb-4">Timer Finished</h2>
    //         <button
    //           onClick={() => setIsFinished(false)} // 팝업 닫기 버튼
    //           className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
    //         >
    //           Close
    //         </button>
    //       </div>
    //     </div>
    //   ) : (
      <div className="flex flex-col items-center gap-4">
        {/* <Timer startTimer={startTimer} onFinish={handleTimerFinish} /> */}
        {/* 레벨 클리어 표 (1 ~ 9까지 예시) */}
        <div className="mt-4 p-4 border border-gray-300 rounded">
          <h3 className="text-lg font-bold mb-2">스테이지 상태</h3>
          <table className="min-w-[400px] border-collapse">
            <thead>
              <tr>
                <th className="border p-2">레벨</th>
                <th className="border p-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {/* 1부터 TOTAL_LEVELS(9)까지 순회 */}
              {Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1).map(level => {
                const isCleared = completedLevels.includes(level);
                return (
                  <tr key={level}>
                    <td className="border p-2 text-center">{level}</td>
                    <td className="border p-2 text-center">
                      {isCleared ? '완료' : '미완료'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mb-4">
          {/* <div>
            <button onClick={handleButtonClick}>Show Cursors Length</button>
          </div> */}
          <button onClick={handleShowBodies}>Show All Bodies</button>
          <button
            onClick={() => resetLevel()}
            className={`p-2 rounded 'bg-gray-200'`}
          >
            <RefreshCw size={24} />
          </button>
          <button
            onClick={() => handleToolChange('pen')}
            className={`p-2 rounded ${
              tool === 'pen' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Pen size={24} />
          </button>
          <button
            onClick={() => handleToolChange('eraser')}
            className={`p-2 rounded ${
              tool === 'eraser' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Eraser size={24} />
          </button>
          <button
            onClick={() => handleToolChange('pin')}
            className={`p-2 rounded ${
              tool === 'pin' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Pin size={24} />
          </button>
          <button
            onClick={() => handleToolChange('chain')}
            className={`p-2 rounded ${
              tool === 'chain' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Link size={24} />
          </button>
          {/* 밀기 도구 버튼 */}
          <button
            onClick={() => handleToolChange('push')}
            className={`p-2 rounded relative ${tool === 'push' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* 공을 뒤에 배치 */}
            <Circle size={20} style={{ position: 'absolute', left: '6px', zIndex: 1 }} />
            {/* 손이 약간 겹치도록 배치 */}
            <Hand size={22} style={{ position: 'relative', left: '8px', zIndex: 2, transform: 'rotate(-20deg)' }} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <h2
            className={`text-lg font-bold ${
              currentTurn === 'player1' ? 'text-blue-500' : 'text-red-500'
            }`}
          >
            {currentTurn === 'player1' ? "플레이어1 차례" : "플레이어2 차례"}
          </h2>
        </div>
        
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="border border-gray-300 rounded-lg shadow-lg"
            style={{ cursor: tool === 'eraser' ? 'crosshair' : 'default' }}
          />
          
          {/* 커서를 표시하는 별도의 캔버스 */}
          <canvas
            ref={cursorCanvasRef}
            width={800}
            height={600}
            className="absolute top-0 left-0 border border-transparent pointer-events-none"
            style={{
              zIndex: 10, // 게임 캔버스 위에 렌더링
            }}
          />
          
          {isDrawing && tool === 'pen' && (
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
              width={800}
              height={600}
            >
              <path
                d={`M ${drawPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
                strokeDasharray="4"
              />
            </svg>
          )}

          {gameEnded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
              <div className="bg-white p-8 rounded-lg shadow-xl">
                <h2 className="text-3xl font-bold text-center mb-4">레벨 클리어!</h2>
                <button
                  onClick={() => handleNextLevel()}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {currentLevel < TOTAL_LEVELS ? '다음 레벨로 이동' : '확인'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => handleLevelChange('prev')}
            disabled={currentLevel === 1}
            className="p-2 rounded bg-gray-200 disabled:opacity-50"
          >
            <ChevronLeft size={24} />
          </button>
          <span className="py-2 px-4 bg-gray-100 rounded">레벨 {currentLevel}</span>
          <button
            onClick={() => handleLevelChange('next')}
            disabled={currentLevel === TOTAL_LEVELS}
            className="p-2 rounded bg-gray-200 disabled:opacity-50"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>
      // )}
    // </div>
  );
};

export default PhysicsCanvas;